import { COUNTRY_BY_ISO3, DEFAULT_COUNTRY } from "@/lib/domain/countries";
import { scanCountry } from "@/lib/engine/scan";
import { makeTracer, type TraceEvent } from "@/lib/engine/trace";
import {
  ExtractionError,
  MAX_UPLOAD_BYTES,
  extractPdf,
} from "@/lib/ideas/extract";
import {
  countryFromMatches,
  detectCountry,
  detectRouteIntent,
  matchSegments,
} from "@/lib/ideas/match";
import { buildVerdict, type IdeaVerdict } from "@/lib/ideas/verdict";
import type { Finding } from "@/lib/engine/scan";
import type { SegmentMatch } from "@/lib/ideas/match";

/**
 * Assess an idea the user already has.
 *
 * Streams the same trace events as the scan endpoint, so the reasoning graph
 * shows the document being read and matched before the market work starts —
 * which matters more here than in a scan, because the match is the step most
 * likely to be wrong and the user is the only one who can catch it.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface ValidateResult {
  document: { name: string; pages: number; characters: number };
  country: { iso3: string; name: string; detected: boolean };
  match: SegmentMatch;
  alternatives: SegmentMatch[];
  finding: Finding;
  verdict: IdeaVerdict;
  scanElapsedMs: number;
  generatedAt: string;
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  const fallbackIso3 = String(form.get("country") ?? DEFAULT_COUNTRY);
  const fallback =
    COUNTRY_BY_ISO3.get(fallbackIso3) ?? COUNTRY_BY_ISO3.get(DEFAULT_COUNTRY)!;

  if (!(file instanceof File)) {
    return Response.json({ error: "No file was uploaded." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`,
      },
      { status: 413 },
    );
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json(
      { error: "Only PDF files are supported." },
      { status: 415 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
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
      request.signal.addEventListener("abort", () => {
        closed = true;
      });

      const tracer = makeTracer(send);

      try {
        // ---- Read ---------------------------------------------------------
        tracer.phase("Reading the document");
        const doc = await extractPdf(bytes);
        tracer.note(
          `${doc.pages} page${doc.pages === 1 ? "" : "s"}, ${doc.length.toLocaleString()} characters of text`,
        );

        // ---- Locate -------------------------------------------------------
        tracer.phase("Locating the idea in the taxonomy");
        const countryMatches = detectCountry(doc.text);
        const { country: iso3, detected } = countryFromMatches(
          countryMatches,
          fallback,
        );
        const country = COUNTRY_BY_ISO3.get(iso3) ?? fallback;

        const countryNodeId = `country:${country.iso3}`;
        tracer.node({
          id: countryNodeId,
          kind: "country",
          label: country.name,
          detail: detected
            ? `Named in the document ${countryMatches[0].mentions} times`
            : `Not clearly named in the document — using the selected market`,
          status: "active",
        });

        tracer.node({
          id: "doc:file",
          kind: "source",
          label: file.name.replace(/\.pdf$/i, "").slice(0, 40),
          parent: countryNodeId,
          detail: `${doc.pages} pages · ${doc.length.toLocaleString()} characters extracted`,
          status: "ok",
        });

        const matches = matchSegments(doc.text, 5);
        if (matches.length === 0) {
          throw new ExtractionError(
            "Nothing in the document matched the segment taxonomy. It may describe a business this system does not model, or the text may be too sparse to match on.",
          );
        }

        matches.forEach((m, i) => {
          tracer.node({
            id: `match:${m.segmentId}`,
            kind: "finding",
            label: m.name,
            parent: "doc:file",
            detail: `${i === 0 ? "Best match" : `Alternative ${i}`} · ${(m.confidence * 100).toFixed(0)}% · matched on ${m.evidence.slice(0, 4).join(", ")}`,
            status: i === 0 ? "ok" : "empty",
          });
        });

        const intent = detectRouteIntent(doc.text);
        if (intent.route) {
          tracer.note(
            `Document proposes an entry route: ${intent.route}${intent.matched ? ` ("${intent.matched.trim()}")` : ""}`,
          );
        }

        // ---- Assess -------------------------------------------------------
        // The whole country is scanned rather than just the matched sector,
        // because "is this good" is partly "compared to what else is available
        // here", and that answer needs the full ranking.
        const best = matches[0];
        const scan = await scanCountry(country.iso3, {
          tracer,
          drillDown: true,
          // The segment the document is about matters more here than the
          // leaderboard, and it is often nowhere near the top of it.
          drillSegments: [best.segmentId],
        });
        const finding = scan.findings.find(
          (f) => f.segmentId === best.segmentId,
        );
        if (!finding) {
          throw new Error("The matched segment was not scored for this country.");
        }

        tracer.phase("Judging the idea");
        const verdictNodeId = `verdict:${finding.segmentId}`;
        tracer.node({
          id: verdictNodeId,
          kind: "finding",
          label: "Verdict",
          parent: `segment:${finding.segmentId}`,
          status: "active",
        });

        const verdict = buildVerdict({ finding, scan, match: best, intent });

        tracer.status(verdictNodeId, verdict.standing === "weak" ? "error" : "ok", {
          weight: finding.score,
          detail: `${verdict.headline} — ranks ${verdict.rank} of ${verdict.totalScored} in ${country.name}`,
        });

        const payload: ValidateResult = {
          document: {
            name: file.name,
            pages: doc.pages,
            characters: doc.length,
          },
          country: { iso3: country.iso3, name: country.name, detected },
          match: best,
          alternatives: matches.slice(1),
          finding,
          verdict,
          scanElapsedMs: scan.elapsedMs,
          generatedAt: new Date().toISOString(),
        };

        send({ t: "result", payload });
      } catch (err) {
        send({
          t: "error",
          message:
            err instanceof ExtractionError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Assessment failed",
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
      "x-accel-buffering": "no",
    },
  });
}
