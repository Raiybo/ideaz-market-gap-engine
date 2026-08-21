"use client";

/**
 * Where every number came from.
 *
 * Kept as a first-class panel rather than a footnote because the engine's
 * central claim is that its findings are measured rather than asserted, and a
 * claim like that is only worth anything if the reader can go and check it.
 * The caveats are shown at the same weight as the sources — a dataset's known
 * limitation is part of what it says.
 */

import { useState } from "react";

import { SOURCE_LIST } from "@/lib/domain/sources";

export function SourcesPanel() {
  const [open, setOpen] = useState(false);

  const live = SOURCE_LIST.filter((s) => s.kind === "live");
  const reference = SOURCE_LIST.filter((s) => s.kind === "reference");

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Sources and method</h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-[var(--accent)] hover:underline"
        >
          {open ? "Hide" : `Show all ${SOURCE_LIST.length} sources`}
        </button>
      </div>

      <p className="mt-1 text-sm text-[var(--muted)]">
        {live.length} live datasets queried per scan, {reference.length}{" "}
        reference sources behind the curated coefficients. Every figure on a
        card carries its own provenance label — measured, researched or
        modelled — and the three never mean the same thing.
      </p>

      {open && (
        <div className="mt-4 space-y-5">
          {[
            ["Queried live, every scan", live],
            ["Reference basis for curated values", reference],
          ].map(([heading, list]) => (
            <div key={heading as string}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {heading as string}
              </p>
              <div className="space-y-3">
                {(list as typeof SOURCE_LIST).map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-sm font-medium text-[var(--accent)] hover:underline"
                      >
                        {s.name}
                      </a>
                      <span className="text-xs text-[var(--muted)]">
                        {s.publisher}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {s.drives}
                    </p>
                    {s.caveat && (
                      <p className="mt-1.5 border-l-2 border-[var(--warning)]/50 pl-2 text-xs text-[var(--muted)]">
                        <span className="font-medium text-[var(--warning)]">
                          Limitation:{" "}
                        </span>
                        {s.caveat}
                      </p>
                    )}
                    <p className="mt-1.5 font-mono text-[10px] text-[var(--muted)] opacity-70">
                      {s.cadence} · {s.licence}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
