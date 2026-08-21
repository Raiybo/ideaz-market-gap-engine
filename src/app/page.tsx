"use client";

import { useMemo, useState } from "react";

import { FindingCard } from "@/components/FindingCard";
import { ReasoningGraph } from "@/components/ReasoningGraph";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/domain/countries";
import { SECTORS } from "@/lib/domain/sectors";
import type { CountryScan } from "@/lib/engine/scan";
import { useScanStream } from "@/lib/useScanStream";

const CONDITION_LABELS: Array<{
  key: keyof CountryScan["conditions"];
  label: string;
  /** True when a high value is bad, so the bar can be coloured honestly. */
  inverted: boolean;
}> = [
  { key: "gridReliability", label: "Grid reliability", inverted: false },
  { key: "currencyInstability", label: "Currency instability", inverted: true },
  { key: "capitalScarcity", label: "Capital scarcity", inverted: true },
  { key: "importDependence", label: "Import dependence", inverted: true },
  { key: "bureaucraticFriction", label: "Bureaucratic friction", inverted: true },
  { key: "informality", label: "Informality", inverted: true },
];

/** Findings shown before the list has to be asked for in full. */
const VISIBLE_FINDINGS = 12;

function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export default function Home() {
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [scope, setScope] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const [graphOpen, setGraphOpen] = useState(true);

  const { nodes, phase, note, running, scan, error, elapsedMs, rerun } =
    useScanStream(country, scope);

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
                onChange={(e) => {
                  setCountry(e.target.value);
                  setShowAll(false);
                  setGraphOpen(true);
                }}
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

      {/* Scope rail — the whole country, or one sector in depth. */}
      <nav className="rail -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {[
          { id: "all", icon: "🌍", name: "Whole country" },
          ...SECTORS.map((s) => ({ id: s.id, icon: s.icon, name: s.name })),
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setScope(s.id);
              setShowAll(false);
              setGraphOpen(true);
            }}
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

      {scan && (
        <>
          {scan.macro.length > 0 && (
            <section className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
              {scan.macro.map((m) => (
                <div key={m.label} className="bg-[var(--surface)] p-3">
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
                    onClick={() => {
                      setScope(s.id);
                      setGraphOpen(true);
                    }}
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
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">
                Operating conditions — {scan.country.name}
              </h2>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  scan.conditionsCurated
                    ? "bg-[var(--positive)]/12 text-[var(--positive)]"
                    : "bg-[var(--warning)]/12 text-[var(--warning)]"
                }`}
              >
                {scan.conditionsCurated
                  ? "Researched"
                  : "Neutral defaults — not individually researched"}
              </span>
            </div>

            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {CONDITION_LABELS.map(({ key, label, inverted }) => {
                const raw = scan.conditions[key] as number;
                const pct = raw * 100;
                const bad = inverted ? raw > 0.6 : raw < 0.4;
                return (
                  <div key={key}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-xs text-[var(--muted)]">{label}</span>
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
