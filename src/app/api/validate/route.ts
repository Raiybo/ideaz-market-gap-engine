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
import {
  semanticMatch,
  semanticMatchingAvailable,
} from "@/lib/ideas/semantic";
import { buildVerdict, type IdeaVerdict } from "@/lib/ideas/verdict";
import { ALL_SEGMENTS } from "@/lib/domain/sectors";
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

export type MatchMode = "semantic" | "lexical";

export interface ValidateResult {
  document: { name: string; pages: number; characters: number };
  /** How the document was matched, so a weaker mode is never silent. */
  matchMode: MatchMode;
  /** The engine's own restatement of the idea, when semantic matching ran. */
  restatement: string | null;
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
        // Classification runs before the market is fixed, because it reads the
        // market too — and reads it better than a name scan can. "Lebanon" in a
        // deck about dairy is a country; in a deck about a county fair it is
        // Pennsylvania, and only the surrounding sentences separate the two.
        tracer.phase("Locating the idea in the taxonomy");

        tracer.node({
          id: "doc:file",
          kind: "source",
          label: file.name.replace(/\.pdf$/i, "").slice(0, 40),
          detail: `${doc.pages} pages · ${doc.length.toLocaleString()} characters extracted`,
          status: "ok",
        });

        // Semantic matching where a key is configured, lexical otherwise. The
        // lexical matcher leans on customs vocabulary, which fails on documents
        // that describe a business in its own words rather than the tariff
        // schedule's — so the stronger path is tried first and the mode is
        // always reported rather than degrading silently.
        tracer.node({
          id: "match:engine",
          kind: "source",
          label: semanticMatchingAvailable()
            ? "Reading the idea (Claude)"
            : "Matching by vocabulary",
          parent: "doc:file",
          detail: semanticMatchingAvailable()
            ? "Classifying the document against 73 segments"
            : "Lexical match against segment and customs vocabulary",
          status: "active",
        });

        const semantic = await semanticMatch(doc.text);
        let matchMode: MatchMode = semantic ? "semantic" : "lexical";
        let matches: SegmentMatch[];
        let intent = detectRouteIntent(doc.text);

        if (semantic) {
          const byId = new Map(
            ALL_SEGMENTS.map((entry) => [entry.segment.id, entry]),
          );
          matches = semantic.matches
            .map((m) => {
              const found = byId.get(m.segmentId);
              if (!found) return null;
              return {
                segmentId: m.segmentId,
                sectorId: found.sector.id,
                name: found.segment.name,
                sectorName: found.sector.name,
                score: m.confidence,
                confidence: m.confidence,
                evidence: [m.reasoning],
              } satisfies SegmentMatch;
            })
            .filter((m): m is SegmentMatch => m !== null);

          if (semantic.route) {
            intent = { route: semantic.route, matched: semantic.routeEvidence };
          }
          tracer.status("match:engine", "ok", {
            detail: semantic.restatement || "Document classified",
          });
        } else {
          matches = matchSegments(doc.text, 5);
          tracer.status("match:engine", semanticMatchingAvailable() ? "error" : "empty", {
            detail: semanticMatchingAvailable()
              ? "Claude classification failed; fell back to vocabulary matching"
              : "No ANTHROPIC_API_KEY set — vocabulary matching only",
          });
        }

        if (matches.length === 0) {
          // Semantic matching can return only ids the taxonomy rejects; the
          // lexical matcher is the floor rather than an error.
          matches = matchSegments(doc.text, 5);
          matchMode = "lexical";
        }
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
            parent: "match:engine",
            detail: `${i === 0 ? "Best match" : `Alternative ${i}`} · ${(m.confidence * 100).toFixed(0)}% · ${m.evidence.slice(0, 4).join(", ")}`,
            status: i === 0 ? "ok" : "empty",
          });
        });

        if (intent.route) {
          tracer.note(
            `Document proposes an entry route: ${intent.route}${intent.matched ? ` ("${intent.matched.trim()}")` : ""}`,
          );
        }

        // ---- Market -------------------------------------------------------
        const countryMatches = detectCountry(doc.text);
        const lexical = countryFromMatches(countryMatches, fallback);
        const semanticCountry = semantic?.countryIso3
          ? COUNTRY_BY_ISO3.get(semantic.countryIso3)
          : undefined;
        const country =
          semanticCountry ?? COUNTRY_BY_ISO3.get(lexical.country) ?? fallback;
        const detected = Boolean(semanticCountry) || lexical.detected;

        const countryNodeId = `country:${country.iso3}`;
        tracer.node({
          id: countryNodeId,
          kind: "country",
          label: country.name,
          detail: semanticCountry
            ? semantic?.countryReasoning || "Read from the document"
            : lexical.detected
              ? `Named in the document ${countryMatches[0].mentions} times`
              : "Not clearly named in the document — using the selected market",
          status: "active",
        });
        tracer.edge(countryNodeId, "doc:file");

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
          matchMode,
          restatement: semantic?.restatement ?? null,
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
