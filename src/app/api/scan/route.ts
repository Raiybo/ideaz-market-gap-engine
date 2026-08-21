import { COUNTRY_BY_ISO3 } from "@/lib/domain/countries";
import { SECTOR_BY_ID } from "@/lib/domain/sectors";
import { scanCountry } from "@/lib/engine/scan";
import { makeTracer, type TraceEvent } from "@/lib/engine/trace";

/**
 * The scan endpoint, in two modes.
 *
 * `stream=1` returns Server-Sent Events: the reasoning trace as it happens,
 * followed by the result. That is what the live graph consumes — the graph is
 * not a replay of a finished run, it is the run.
 *
 * Without it, the same scan returns as one JSON document, which is what a
 * script or a cold cache warm-up wants.
 */

// SSE must not be buffered or statically optimised.
export const dynamic = "force-dynamic";
// 60s is the ceiling on Vercel's Hobby plan and is comfortably above a cold
// scan (~40s, dominated by the Comtrade rate limiter) and a warm one (~20s).
export const maxDuration = 60;

function resolve(request: Request) {
  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");
  const sectorParam = searchParams.get("sector");
  const sectorId = sectorParam && sectorParam !== "all" ? sectorParam : undefined;

  if (!country || !COUNTRY_BY_ISO3.has(country)) {
    return { error: "Unknown or missing country", status: 400 as const };
  }
  if (sectorId && !SECTOR_BY_ID.has(sectorId)) {
    return { error: `Unknown sector: ${sectorId}`, status: 400 as const };
  }
  return {
    country,
    sectorId,
    stream: searchParams.get("stream") === "1",
    drillDown: searchParams.get("drill") !== "0",
  };
}

export async function GET(request: Request) {
  const resolved = resolve(request);
  if ("error" in resolved) {
    return Response.json(
      { error: resolved.error },
      { status: resolved.status },
    );
  }

  const { country, sectorId, stream, drillDown } = resolved;

  if (!stream) {
    try {
      const scan = await scanCountry(country, { sectorId, drillDown });
      return Response.json(scan);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Scan failed" },
        { status: 500 },
      );
    }
  }

  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: TraceEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      // The client aborting is the normal way this ends when someone switches
      // country mid-scan; stop writing rather than throwing into the void.
      request.signal.addEventListener("abort", () => {
        closed = true;
      });

      try {
        const scan = await scanCountry(country, {
          sectorId,
          drillDown,
          tracer: makeTracer(send),
        });
        send({ t: "result", payload: scan });
      } catch (err) {
        send({
          t: "error",
          message: err instanceof Error ? err.message : "Scan failed",
        });
      } finally {
        send({ t: "done" });
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Disables proxy buffering, which otherwise holds the whole stream back
      // and delivers it as one burst at the end — the exact opposite of live.
      "x-accel-buffering": "no",
    },
  });
}
