"use client";

/**
 * Upload an idea and have the engine judge it.
 *
 * The scan asks "what should I do here". This asks the harder question — "I
 * already intend to do this, is it any good" — and the interface has to be
 * willing to answer no. The standing banner leads, the reasons follow, and the
 * ways to strengthen it come before the ways it dies, because a reader who has
 * just been told their idea is weak needs the route out of that before the
 * elaboration of it.
 */

import { useRef, useState } from "react";

import type { ValidateResult } from "@/app/api/validate/route";
import { COUNTRY_BY_ISO3 } from "@/lib/domain/countries";
import type { Standing } from "@/lib/ideas/verdict";
import { FindingCard } from "@/components/FindingCard";

const STANDING_STYLE: Record<
  Standing,
  { color: string; label: string }
> = {
  strong: { color: "var(--positive)", label: "Strong" },
  workable: { color: "var(--accent)", label: "Workable" },
  conditional: { color: "var(--warning)", label: "Conditional" },
  weak: { color: "var(--danger)", label: "Weak" },
};

export function IdeaUploader({
  onFile,
  running,
  fileName,
  onClear,
}: {
  onFile: (file: File) => void;
  running: boolean;
  fileName: string | null;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files);
      }}
      className={`rounded-xl border border-dashed p-6 text-center transition-colors ${
        dragging
          ? "border-[var(--accent)] bg-[var(--accent)]/5"
          : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => take(e.target.files)}
      />

      {fileName ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <span className="font-mono text-sm">{fileName}</span>
          <button
            onClick={onClear}
            disabled={running}
            className="text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-40"
          >
            Use a different file
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium">
            Drop a PDF here, or{" "}
            <button
              onClick={() => inputRef.current?.click()}
              disabled={running}
              className="text-[var(--accent)] hover:underline disabled:opacity-40"
            >
              choose a file
            </button>
          </p>
          <p className="mx-auto mt-1.5 max-w-lg text-xs text-[var(--muted)]">
            A deck, a one-pager, a business plan — anything that describes the
            idea in text. The engine matches it to a segment and a market, then
            judges it against the same live trade and supply data it uses to
            find gaps. Scanned images cannot be read; the text has to be
            selectable.
          </p>
        </>
      )}
    </div>
  );
}

function PointList({
  points,
  bullet,
}: {
  points: Array<{ label: string; detail: string }>;
  bullet: string;
}) {
  return (
    <ul className="space-y-3">
      {points.map((p, i) => (
        <li key={i}>
          <p className="flex gap-2 text-sm font-medium">
            <span style={{ color: bullet }}>•</span>
            <span>{p.label}</span>
          </p>
          <p className="mt-0.5 pl-4 text-sm leading-relaxed text-[var(--muted)]">
            {p.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function IdeaAssessment({
  assessment,
  onPickAlternative,
}: {
  assessment: ValidateResult;
  onPickAlternative: (segmentId: string) => void;
}) {
  const {
    verdict,
    alternatives,
    finding,
    country,
    document: doc,
    matchMode,
    restatement,
  } = assessment;
  const style = STANDING_STYLE[verdict.standing];

  return (
    <div className="space-y-5">
      {/* Standing */}
      <section
        className="rounded-xl border p-5"
        style={{
          borderColor: `color-mix(in srgb, ${style.color} 45%, transparent)`,
          background: `color-mix(in srgb, ${style.color} 7%, transparent)`,
        }}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            className="rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide"
            style={{
              background: `color-mix(in srgb, ${style.color} 18%, transparent)`,
              color: style.color,
            }}
          >
            {style.label}
          </span>
          <h2 className="text-lg font-semibold">{verdict.headline}</h2>
        </div>

        <p className="mt-3 text-sm leading-relaxed">{verdict.summary}</p>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--muted)]">
          <span className="font-mono">
            Ranks {verdict.rank} of {verdict.totalScored} in {country.name}
          </span>
          <span className="font-mono">{verdict.percentile}th percentile</span>
          <span className="font-mono">{finding.score.toFixed(1)}/100</span>
          <span>
            {doc.pages} page{doc.pages === 1 ? "" : "s"} read
          </span>
          {!country.detected && (
            <span className="text-[var(--warning)]">
              Market not named in the document — assessed against{" "}
              {country.name}
            </span>
          )}
        </div>

        {/* Percentile bar */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ width: `${verdict.percentile}%`, background: style.color }}
          />
        </div>
      </section>

      {/* Route: proposed vs what the data supports */}
      <section
        className={`rounded-xl border p-5 ${
          verdict.route.agrees
            ? "border-[var(--border)] bg-[var(--surface)]"
            : "border-[var(--warning)]/45 bg-[var(--warning)]/6"
        }`}
      >
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          {verdict.route.agrees
            ? "The way in"
            : "The document and the data disagree on the way in"}
        </h3>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {verdict.route.proposedName && (
            <>
              <span className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1">
                Document: <strong>{verdict.route.proposedName}</strong>
              </span>
              <span className="text-[var(--muted)]">
                {verdict.route.agrees ? "≡" : "→"}
              </span>
            </>
          )}
          <span
            className="rounded-lg px-2.5 py-1"
            style={{
              background: "color-mix(in srgb, var(--accent) 12%, transparent)",
              color: "var(--accent)",
            }}
          >
            Data: <strong>{verdict.route.recommendedName}</strong>
          </span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          {verdict.route.detail}
        </p>
      </section>

      {/* For and against */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--positive)]">
            What holds up
          </h3>
          {verdict.supports.length > 0 ? (
            <PointList points={verdict.supports} bullet="var(--positive)" />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Nothing in the measured data argues in favour of this one. That is
              the finding, not an absence of one.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--danger)]">
            What argues against it
          </h3>
          {verdict.againsts.length > 0 ? (
            <PointList points={verdict.againsts} bullet="var(--danger)" />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              No measured signal argues against it. Absence of a red flag is not
              the same as evidence, so weigh it accordingly.
            </p>
          )}
        </section>
      </div>

      {/* How to make it better */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--accent)]">
          How to make it stronger
        </h3>
        <PointList points={verdict.strengthen} bullet="var(--accent)" />
      </section>

      {/* Kill criteria */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Decide in advance what would make you drop it
        </h3>
        <ul className="space-y-2">
          {verdict.killCriteria.map((k, i) => (
            <li key={i} className="flex gap-2 text-sm text-[var(--muted)]">
              <span className="text-[var(--danger)]">✕</span>
              <span>{k}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Match transparency */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{
              background:
                matchMode === "semantic"
                  ? "color-mix(in srgb, var(--positive) 14%, transparent)"
                  : "color-mix(in srgb, var(--warning) 14%, transparent)",
              color:
                matchMode === "semantic"
                  ? "var(--positive)"
                  : "var(--warning)",
            }}
          >
            {matchMode === "semantic" ? "read by Claude" : "vocabulary match"}
          </span>
          {matchMode === "lexical" && (
            <span className="text-xs text-[var(--muted)]">
              Matching compares words, not meaning — a document that describes
              its business without using the category&apos;s usual nouns can be
              matched to the wrong segment. Set ANTHROPIC_API_KEY to enable
              semantic reading.
            </span>
          )}
        </div>
        {restatement && (
          <p className="mb-2 text-sm">
            <span className="text-[var(--muted)]">Read as: </span>
            {restatement}
          </p>
        )}
        <p className="text-xs text-[var(--muted)]">{verdict.matchNote}</p>
        {alternatives.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--muted)]">
              Other segments it could be:
            </span>
            {alternatives.map((a) => (
              <button
                key={a.segmentId}
                onClick={() => onPickAlternative(a.sectorId)}
                className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--accent)] hover:underline"
                title={`Matched on ${a.evidence.join(", ")}`}
              >
                {a.name} ({(a.confidence * 100).toFixed(0)}%)
              </button>
            ))}
          </div>
        )}
      </section>

      {/* The underlying finding, in full */}
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          The segment this was judged against
        </h3>
        <FindingCard
          finding={finding}
          rank={verdict.rank}
          country={country.iso3}
          conditions={COUNTRY_BY_ISO3.get(country.iso3)?.conditions}
          showSector
        />
      </div>
    </div>
  );
}
