"use client";

import { useEffect, useMemo, useState } from "react";

import { OpportunityCard } from "@/components/OpportunityCard";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/domain/countries";
import { SECTORS } from "@/lib/domain/sectors";
import type { SectorAnalysis } from "@/lib/engine/analyze";

const CONDITION_LABELS: Array<{
  key: keyof SectorAnalysis["conditions"];
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

export default function Home() {
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [sector, setSector] = useState(SECTORS[0].id);

  /**
   * The result carries the key it was fetched for, so "is this stale?" is
   * derived rather than tracked in a separate loading flag. That keeps every
   * setState inside an async callback instead of the effect body, which is
   * what avoids the cascading re-render React warns about.
   */
  const requestKey = `${country}|${sector}`;
  const [result, setResult] = useState<{
    key: string;
    data?: SectorAnalysis;
    error?: string;
  } | null>(null);

  const loading = result?.key !== requestKey;
  const data = result?.key === requestKey ? result.data : undefined;
  const error = result?.key === requestKey ? result.error : undefined;

  useEffect(() => {
    const controller = new AbortController();
    const key = `${country}|${sector}`;

    fetch(`/api/market?country=${country}&sector=${sector}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Request failed");
        return body as SectorAnalysis;
      })
      .then((body) => setResult({ key, data: body }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResult({
          key,
          error: err instanceof Error ? err.message : "Something went wrong",
        });
      });

    return () => controller.abort();
  }, [country, sector]);

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

  const activeSector = SECTORS.find((s) => s.id === sector)!;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Market Gap Engine
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
              Finds business opportunities by measuring what a market demands
              against what it actually produces. Ranked by the size of the gap,
              discounted by whether you could realistically serve it.
            </p>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              Country
            </span>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
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
        </div>
      </header>

      {/* Sector rail */}
      <nav className="rail -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {SECTORS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSector(s.id)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm transition-colors ${
              s.id === sector
                ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--muted)]"
            }`}
          >
            <span className="mr-1.5">{s.icon}</span>
            {s.name}
          </button>
        ))}
      </nav>

      <p className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
        <span className="mr-1.5">{activeSector.icon}</span>
        {activeSector.blurb}
      </p>

      {error && (
        <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--muted)]">
            Querying World Bank indicators and UN Comtrade customs records…
          </p>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]"
            />
          ))}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Macro strip */}
          {data.macro.length > 0 && (
            <section className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
              {data.macro.map((m) => (
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

          {data.warnings.length > 0 && (
            <div className="mb-6 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/8 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--warning)]">
                Data caveats
              </p>
              <ul className="space-y-1">
                {data.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-[var(--muted)]">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Opportunities */}
          <section className="mb-8 space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">
                {data.sector.name} in {data.country.name}
              </h2>
              <span className="text-xs text-[var(--muted)]">
                {data.opportunities.length} segments ranked
              </span>
            </div>

            {data.opportunities.map((o, i) => (
              <OpportunityCard
                key={o.segmentId}
                opportunity={o}
                rank={i + 1}
                country={data.country.iso3}
              />
            ))}
          </section>

          {/* Market conditions */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">
                Operating conditions — {data.country.name}
              </h2>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  data.conditionsCurated
                    ? "bg-[var(--positive)]/12 text-[var(--positive)]"
                    : "bg-[var(--warning)]/12 text-[var(--warning)]"
                }`}
              >
                {data.conditionsCurated
                  ? "Researched"
                  : "Neutral defaults — not individually researched"}
              </span>
            </div>

            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {CONDITION_LABELS.map(({ key, label, inverted }) => {
                const raw = data.conditions[key] as number;
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
                          background: bad
                            ? "var(--danger)"
                            : "var(--positive)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {data.conditions.notes.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-[var(--border)] pt-3">
                {data.conditions.notes.map((n, i) => (
                  <li key={i} className="flex gap-2 text-sm text-[var(--muted)]">
                    <span className="text-[var(--accent)]">•</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <footer className="mt-6 text-xs text-[var(--muted)]">
            Generated {new Date(data.generatedAt).toLocaleString()} · Live
            sources: World Bank Open Data, UN Comtrade. Structural coefficients
            and country conditions are curated in-repo and marked as such on
            every card.
          </footer>
        </>
      )}
    </div>
  );
}
