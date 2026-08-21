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

import type { CountryScan } from "@/lib/engine/scan";
import type { TraceEvent, TraceNode } from "@/lib/engine/trace";

export interface ScanStreamState {
  nodes: Map<string, TraceNode>;
  phase: string | null;
  note: string | null;
  running: boolean;
  scan: CountryScan | null;
  error: string | null;
  elapsedMs: number | null;
}

const INITIAL: ScanStreamState = {
  nodes: new Map(),
  phase: null,
  note: null,
  running: false,
  scan: null,
  error: null,
  elapsedMs: null,
};

export function useScanStream(country: string, scope: string) {
  const [state, setState] = useState<ScanStreamState>(INITIAL);
  const [nonce, setNonce] = useState(0);
  const startedAt = useRef<number>(0);

  const rerun = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    startedAt.current = Date.now();
    setState({ ...INITIAL, nodes: new Map(), running: true });

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

      setState((prev) => {
        const nodes = new Map(prev.nodes);
        let { phase, note, running, scan, error } = prev;
        let elapsedMs = prev.elapsedMs;

        for (const event of batch) {
          switch (event.t) {
            case "node":
              // A node may be re-announced; never let that regress a status
              // that has already resolved.
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
              scan = event.payload as CountryScan;
              elapsedMs = (event.payload as CountryScan).elapsedMs;
              break;
            case "error":
              error = event.message;
              break;
            case "done":
              running = false;
              phase = null;
              note = null;
              if (elapsedMs === null) elapsedMs = Date.now() - startedAt.current;
              break;
          }
        }

        return { nodes, phase, note, running, scan, error, elapsedMs };
      });
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

        const reader = res.body.getReader();
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
              pending.push(JSON.parse(line.slice(6)) as TraceEvent);
            } catch {
              // A malformed frame is not worth taking the stream down for.
            }
          }
          schedule();
        }
        schedule();
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
  }, [country, scope, nonce]);

  return { ...state, rerun };
}
