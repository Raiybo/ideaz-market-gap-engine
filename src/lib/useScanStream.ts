"use client";

/**
 * Consumes the scan endpoint's event stream and keeps the reasoning graph in
 * sync with it.
 *
 * Uses fetch + a stream reader rather than EventSource for one reason that
 * matters here: switching country mid-scan has to abort the request in flight,
 * and EventSource cannot be cancelled deterministically. A scan that keeps
 * running after the user has moved on burns the Comtrade rate limit that the
 * next scan needs.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ValidateResult } from "@/app/api/validate/route";
import type { CountryScan } from "@/lib/engine/scan";
import type { TraceEvent, TraceNode } from "@/lib/engine/trace";

export interface TraceStreamState<T> {
  nodes: Map<string, TraceNode>;
  phase: string | null;
  note: string | null;
  running: boolean;
  result: T | null;
  error: string | null;
  elapsedMs: number | null;
}

function initialState<T>(): TraceStreamState<T> {
  return {
    nodes: new Map(),
    phase: null,
    note: null,
    running: false,
    result: null,
    error: null,
    elapsedMs: null,
  };
}

/**
 * Fold a batch of trace events into stream state.
 *
 * Shared by both hooks because the graph half of the state is identical
 * whether the engine was asked to find gaps or to judge one — only the shape
 * of the final result differs.
 */
function applyEvents<T>(
  prev: TraceStreamState<T>,
  batch: TraceEvent[],
  startedAt: number,
): TraceStreamState<T> {
  const nodes = new Map(prev.nodes);
  let { phase, note, running, result, error } = prev;
  let elapsedMs = prev.elapsedMs;

  for (const event of batch) {
    switch (event.t) {
      case "node":
        // A node may be re-announced — the validate flow declares the country
        // before handing off to the scan, which declares it again. Merging
        // rather than replacing keeps a resolved status from regressing.
        nodes.set(event.node.id, {
          ...nodes.get(event.node.id),
          ...event.node,
        });
        break;
      case "status": {
        const existing = nodes.get(event.id);
        if (!existing) break;
        nodes.set(event.id, {
          ...existing,
          status: event.status,
          detail: event.detail ?? existing.detail,
          weight: event.weight ?? existing.weight,
        });
        break;
      }
      case "phase":
        phase = event.label;
        break;
      case "note":
        note = event.text;
        break;
      case "result":
        result = event.payload as T;
        break;
      case "error":
        error = event.message;
        break;
      case "done":
        running = false;
        phase = null;
        note = null;
        if (elapsedMs === null) elapsedMs = Date.now() - startedAt;
        break;
    }
  }

  return { nodes, phase, note, running, result, error, elapsedMs };
}

/** Read an SSE body, pushing parsed events into `sink`. */
async function readTraceStream(
  response: Response,
  sink: (event: TraceEvent) => void,
  onChunk: () => void,
): Promise<void> {
  if (!response.body) throw new Error("The server returned no stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; the tail of the buffer is
    // usually a partial frame and has to wait for the next chunk.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const raw of frames) {
      const line = raw.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        sink(JSON.parse(line.slice(6)) as TraceEvent);
      } catch {
        // A malformed frame is not worth taking the stream down for.
      }
    }
    onChunk();
  }
  onChunk();
}

/**
 * `enabled` exists so the page can hold the scan back while the user is in
 * idea-assessment mode. Firing a country scan nobody asked for spends the
 * Comtrade rate limit that the assessment is about to need.
 */
export function useScanStream(country: string, scope: string, enabled = true) {
  const [state, setState] = useState<TraceStreamState<CountryScan>>(
    initialState<CountryScan>,
  );
  const [nonce, setNonce] = useState(0);
  const startedAt = useRef<number>(0);

  const rerun = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    startedAt.current = Date.now();
    setState({ ...initialState<CountryScan>(), running: true });

    /**
     * Events arrive in bursts — 23 indicator nodes land in one chunk — so they
     * are buffered and applied on an animation frame. Without this the graph
     * re-lays-out 23 times for one logical step and visibly stutters.
     */
    let pending: TraceEvent[] = [];
    let frame = 0;

    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = [];
      if (batch.length === 0) return;
      setState((prev) => applyEvents(prev, batch, startedAt.current));
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(flush);
    };

    (async () => {
      try {
        const res = await fetch(
          `/api/scan?country=${country}&sector=${scope}&stream=1`,
          { signal: controller.signal, headers: { accept: "text/event-stream" } },
        );
        if (!res.ok || !res.body) {
          throw new Error(`Scan failed with status ${res.status}`);
        }

        await readTraceStream(res, (e) => pending.push(e), schedule);
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          running: false,
          error: err instanceof Error ? err.message : "Scan failed",
        }));
      }
    })();

    return () => {
      controller.abort();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [country, scope, nonce, enabled]);

  return { ...state, scan: state.result, rerun };
}

/**
 * Assess a document the user already has.
 *
 * Unlike the scan, this never runs on mount — it is driven by an explicit
 * upload, so the effect-based shape of `useScanStream` would be wrong here.
 */
export function useValidateStream() {
  const [state, setState] = useState<TraceStreamState<ValidateResult>>(
    initialState<ValidateResult>,
  );
  const controllerRef = useRef<AbortController | null>(null);
  const startedAt = useRef(0);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState(initialState<ValidateResult>());
  }, []);

  const run = useCallback(async (file: File, country: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    startedAt.current = Date.now();
    setState({ ...initialState<ValidateResult>(), running: true });

    let pending: TraceEvent[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = [];
      if (batch.length === 0) return;
      setState((prev) => applyEvents(prev, batch, startedAt.current));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(flush);
    };

    const form = new FormData();
    form.append("file", file);
    form.append("country", country);

    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      // Validation failures short-circuit before the stream starts and come
      // back as ordinary JSON, so the content type decides how to read it.
      if (!res.headers.get("content-type")?.includes("text/event-stream")) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed with status ${res.status}`);
      }

      await readTraceStream(res, (e) => pending.push(e), schedule);
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        running: false,
        error: err instanceof Error ? err.message : "Assessment failed",
      }));
    }
  }, []);

  return { ...state, assessment: state.result, run, reset };
}
