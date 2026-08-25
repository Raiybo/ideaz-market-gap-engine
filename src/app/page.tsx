"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { FindingCard } from "@/components/FindingCard";
import {
  IdeaAssessment,
  IdeaUploader,
} from "@/components/IdeaAssessment";
import { ReasoningGraph } from "@/components/ReasoningGraph";
import { SourcesPanel } from "@/components/SourcesPanel";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/domain/countries";
import { SECTORS } from "@/lib/domain/sectors";
import { SOURCES } from "@/lib/domain/sources";
import { useScanStream, useValidateStream } from "@/lib/useScanStream";
import { deltasFor, useWatchlist } from "@/lib/watchlist";

/** Findings shown before the list has to be asked for in full. */
const VISIBLE_FINDINGS = 12;

function formatUsd(value: number): string {
  // Net trade flows go negative for a net exporter. Comparing a negative
  // against the magnitude thresholds fails every one of them and falls through
  // to raw digits, which is how "$-4542071604" reached the page.
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `${sign}$${(v / 1e3).toFixed(0)}K`;
  return `${sign}$${v.toFixed(0)}`;
}

type Mode = "find" | "test";

/**
 * The page reads its opening state from the URL and writes every change back,
 * so a scan is a link. Without it, "look at Lebanon's dairy gap" is four clicks
 * of instructions instead of a URL — and the result is reproducible, because
 * the underlying data is annual and cached rather than a live feed.
 */
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl px-4 py-8 text-sm text-[var(--muted)]">
          Loading…
        </div>
      }
    >
      <Home />
    </Suspense>
  );
}

function Home() {
  const params = useSearchParams();
  const [country, setCountry] = useState(
    () => params.get("country") ?? DEFAULT_COUNTRY,
  );
  const [scope, setScope] = useState(() => params.get("sector") ?? "all");
  const [showAll, setShowAll] = useState(false);
  const [graphOpen, setGraphOpen] = useState(true);
  const [mode, setMode] = useState<Mode>(() =>
    params.get("mode") === "test" ? "test" : "find",
  );
  const [file, setFile] = useState<File | null>(null);
  const watchlist = useWatchlist();

  // replaceState rather than router.push: this is the same view with different
  // inputs, and it should not stack a history entry per click.
  const syncUrl = useCallback(
    (next: { country?: string; sector?: string; mode?: Mode }) => {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      const set = (key: string, value: string | undefined, fallback: string) => {
        if (value === undefined) return;
        if (value === fallback) url.searchParams.delete(key);
        else url.searchParams.set(key, value);
      };
      set("country", next.country, DEFAULT_COUNTRY);
      set("sector", next.sector, "all");
      set("mode", next.mode, "find");
      window.history.replaceState(null, "", url);
    },
    [],
  );

  const pickCountry = useCallback(
    (iso3: string) => {
      setCountry(iso3);
      setShowAll(false);
      setGraphOpen(true);
      syncUrl({ country: iso3 });
    },
    [syncUrl],
  );

  const pickScope = useCallback(
    (id: string) => {
      setScope(id);
      setShowAll(false);
      setGraphOpen(true);
      syncUrl({ sector: id });
    },
    [syncUrl],
  );

  const pickMode = useCallback(
    (next: Mode) => {
      setMode(next);
      syncUrl({ mode: next });
    },
    [syncUrl],
  );

  const scanStream = useScanStream(country, scope, mode === "find");
  const idea = useValidateStream();

  // Both modes drive the same graph; whichever one is live owns it.
  const active = mode === "find" ? scanStream : idea;
  const { nodes, phase, note, running, error, elapsedMs } = active;
  const { scan, rerun } = scanStream;

  const grouped = useMemo(() => {
    const byRegion = new Map<string, typeof COUNTRIES>();
    for (const c of COUNTRIES) {
      const list = byRegion.get(c.region) ?? [];
      list.push(c);
      byRegion.set(c.region, list);
    }
    return Array.from(byRegion.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }, []);

  const findings = scan?.findings ?? [];
  const visible = showAll ? findings : findings.slice(0, VISIBLE_FINDINGS);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Market Gap Engine
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
              Finds where a market&apos;s demand is being met from somewhere
              else, then names a way to take a slice of it. Every figure is
              measured from live customs and macro data, or labelled as
              modelled.
            </p>
          </div>

          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Country
              </span>
              <select
                value={country}
                onChange={(e) => pickCountry(e.target.value)}
                className="min-w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              >
                {grouped.map(([region, list]) => (
                  <optgroup key={region} label={region}>
                    {list.map((c) => (
                      <option key={c.iso3} value={c.iso3}>
                        {c.name}
                        {c.conditions ? " ★" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <button
              onClick={rerun}
              disabled={running}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
              title="Re-run the scan"
            >
              ↻
            </button>
          </div>
        </div>
      </header>

      {/* Mode. Finding a gap and testing an idea you already have are the same
          engine pointed in opposite directions. */}
      <div className="mb-5 flex gap-2">
        {(
          [
            ["find", "Find gaps", "Rank what this market is missing"],
            ["test", "Test my idea", "Upload a deck and have it judged"],
          ] as Array<[Mode, string, string]>
        ).map(([id, label, hint]) => (
          <button
            key={id}
            onClick={() => pickMode(id)}
            title={hint}
            className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
              mode === id
                ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--muted)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "test" && (
        <div className="mb-5 space-y-3">
          <IdeaUploader
            running={idea.running}
            fileName={file?.name ?? null}
            onClear={() => {
              setFile(null);
              idea.reset();
            }}
            onFile={(f) => {
              setFile(f);
              setGraphOpen(true);
              void idea.run(f, country);
            }}
          />
          <p className="text-xs text-[var(--muted)]">
            If the document does not name a market, it is assessed against the
            country selected above.
          </p>
        </div>
      )}

      {/* Scope rail — the whole country, or one sector in depth. */}
      {mode === "find" && (
      <nav className="rail -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {[
          { id: "all", icon: "🌍", name: "Whole country" },
          ...SECTORS.map((s) => ({ id: s.id, icon: s.icon, name: s.name })),
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => pickScope(s.id)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm transition-colors ${
              s.id === scope
                ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--muted)]"
            }`}
          >
            <span className="mr-1.5">{s.icon}</span>
            {s.name}
          </button>
        ))}
      </nav>
      )}

      {/* Live reasoning. Stays available after the run so the result can be
          traced back to the steps that produced it. */}
      {(running || nodes.size > 0) && (
        <div className="mb-6">
          {graphOpen ? (
            <ReasoningGraph
              nodes={nodes}
              phase={phase}
              note={note}
              running={running}
              elapsedMs={elapsedMs}
            />
          ) : null}
          {!running && nodes.size > 0 && (
            <button
              onClick={() => setGraphOpen((v) => !v)}
              className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              {graphOpen ? "Hide reasoning graph" : "Show reasoning graph"}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-[var(--danger)] bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {mode === "test" && idea.assessment && (
        <IdeaAssessment
          assessment={idea.assessment}
          onPickAlternative={(sectorId) => {
            pickMode("find");
            pickScope(sectorId);
          }}
        />
      )}

      {mode === "find" && scan && (
        <>
          {scan.macro.length > 0 && (
            <section className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
              {scan.macro.map((m) => (
                <div
                  key={m.label}
                  className="bg-[var(--surface)] p-3"
                  title={`${m.source} · ${m.period}`}
                >
                  <p className="text-xs text-[var(--muted)]">{m.label}</p>
                  <p className="mt-0.5 font-mono text-lg tabular-nums">
                    {m.value}
                  </p>
                  <p className="text-[10px] text-[var(--muted)] opacity-70">
                    {m.period}
                  </p>
                </div>
              ))}
            </section>
          )}

          {scan.warnings.length > 0 && (
            <div className="mb-6 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/8 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--warning)]">
                Data caveats
              </p>
              <ul className="space-y-1">
                {scan.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-[var(--muted)]">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sector rollup — only meaningful when more than one was scanned. */}
          {scan.scope === "country" && scan.sectors.length > 1 && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                Where the openings are
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {scan.sectors.slice(0, 8).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => pickScope(s.id)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-colors hover:border-[var(--accent)]"
                  >
                    <p className="truncate text-xs text-[var(--muted)]">
                      <span className="mr-1">{s.icon}</span>
                      {s.name}
                    </p>
                    <p className="mt-1 font-mono text-lg tabular-nums">
                      {s.bestScore.toFixed(1)}
                    </p>
                    {s.addressableUsd > 0 && (
                      <p className="font-mono text-[10px] text-[var(--muted)]">
                        {formatUsd(s.addressableUsd)}/yr addressable
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Saved findings. The score shown against each is the score at the
              moment it was saved, so the delta is the market moving rather
              than the engine being re-run. */}
          {watchlist.length > 0 && (
            <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                Saved · {watchlist.length}
              </h2>
              <ul className="space-y-1.5">
                {deltasFor(scan.findings, scan.country.iso3)
                  .slice(0, 8)
                  .map((d) => (
                    <li
                      key={`${d.entry.countryIso3}:${d.entry.segmentId}`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
                    >
                      <button
                        onClick={() => pickCountry(d.entry.countryIso3)}
                        className="text-[var(--accent)] hover:underline"
                      >
                        {d.entry.segmentName}
                      </button>
                      <span className="text-xs text-[var(--muted)]">
                        {d.entry.countryIso3} · {d.entry.sectorName}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-[var(--muted)]">
                        saved at {d.entry.score.toFixed(1)}
                      </span>
                      {d.scoreChange === null ? (
                        <span className="text-xs text-[var(--muted)] opacity-70">
                          not in this scan
                        </span>
                      ) : (
                        <span
                          className="font-mono text-xs tabular-nums"
                          style={{
                            color:
                              d.scoreChange > 0.05
                                ? "var(--positive)"
                                : d.scoreChange < -0.05
                                  ? "var(--danger)"
                                  : "var(--muted)",
                          }}
                          title={`${d.daysHeld} day${d.daysHeld === 1 ? "" : "s"} since saved`}
                        >
                          {d.scoreChange > 0 ? "+" : ""}
                          {d.scoreChange.toFixed(1)}
                          {d.daysHeld > 0 ? ` over ${d.daysHeld}d` : " today"}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <section className="mb-8 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {scan.sector
                  ? `${scan.sector.name} in ${scan.country.name}`
                  : `Ranked openings in ${scan.country.name}`}
              </h2>
              <span className="text-xs text-[var(--muted)]">
                {findings.length} segments scored
              </span>
            </div>

            {scan.sector && (
              <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
                <span className="mr-1.5">{scan.sector.icon}</span>
                {scan.sector.blurb}
              </p>
            )}

            {visible.map((f, i) => (
              <FindingCard
                key={f.segmentId}
                finding={f}
                rank={i + 1}
                country={scan.country.iso3}
                showSector={scan.scope === "country"}
                conditions={scan.conditions}
                scan={scan}
              />
            ))}

            {findings.length > VISIBLE_FINDINGS && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--accent)] transition-colors hover:border-[var(--accent)]"
              >
                {showAll
                  ? "Show top 12 only"
                  : `Show all ${findings.length} scored segments`}
              </button>
            )}
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">
                Operating conditions — {scan.country.name}
              </h2>
              <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--muted)]">
                {
                  scan.conditionFields.filter(
                    (f) => f.provenance === "measured",
                  ).length
                }{" "}
                of {scan.conditionFields.length} measured this scan
              </span>
            </div>
            <p className="mb-4 text-xs text-[var(--muted)]">
              Each dimension is derived from a published indicator where one
              measures it, and held as a researched constant where none does.
              Hover any figure for the derivation.
            </p>

            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {scan.conditionFields.map((f) => {
                const pct = f.value * 100;
                const bad = f.inverted ? f.value > 0.6 : f.value < 0.4;
                const source = SOURCES[f.sourceId];
                return (
                  <div key={f.key} title={f.basis}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-xs text-[var(--muted)]">
                        {f.label}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-[var(--muted)]">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: bad ? "var(--danger)" : "var(--positive)",
                        }}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                        style={{
                          background:
                            f.provenance === "measured"
                              ? "color-mix(in srgb, var(--positive) 14%, transparent)"
                              : f.provenance === "researched"
                                ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                                : "color-mix(in srgb, var(--warning) 14%, transparent)",
                          color:
                            f.provenance === "measured"
                              ? "var(--positive)"
                              : f.provenance === "researched"
                                ? "var(--accent)"
                                : "var(--warning)",
                        }}
                      >
                        {f.provenance}
                        {f.period ? ` ${f.period}` : ""}
                      </span>
                      {source && (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[10px] text-[var(--muted)] hover:text-[var(--accent)] hover:underline"
                        >
                          {source.publisher}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {scan.conditions.notes.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-[var(--border)] pt-3">
                {scan.conditions.notes.map((n, i) => (
                  <li key={i} className="flex gap-2 text-sm text-[var(--muted)]">
                    <span className="text-[var(--accent)]">•</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-4">
            <SourcesPanel />
          </div>

          <footer className="mt-6 text-xs text-[var(--muted)]">
            Scanned in {(scan.elapsedMs / 1000).toFixed(1)}s ·{" "}
            {new Date(scan.generatedAt).toLocaleString()} · Live sources: World
            Bank Open Data, UN Comtrade, OpenStreetMap. Structural coefficients,
            country conditions and entry routes are derived in-repo and labelled
            on every card.
          </footer>
        </>
      )}
    </div>
  );
}
