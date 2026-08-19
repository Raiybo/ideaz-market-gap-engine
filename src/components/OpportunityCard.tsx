"use client";

import { useState } from "react";

import type { Opportunity } from "@/lib/engine/score";

function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function scoreTone(score: number): string {
  if (score >= 62) return "text-[var(--positive)]";
  if (score >= 48) return "text-[var(--warning)]";
  return "text-[var(--muted)]";
}

const COMPONENT_LABELS: Array<{
  key: keyof Opportunity["components"];
  label: string;
  hint: string;
}> = [
  {
    key: "unmetDemand",
    label: "Unmet demand",
    hint: "How much demand is visibly not served by domestic supply.",
  },
  {
    key: "demandStrength",
    label: "Demand size",
    hint: "Absolute market size and spending power behind that demand.",
  },
  {
    key: "feasibility",
    label: "Feasibility",
    hint: "Whether this is executable given local capital, power and bureaucracy.",
  },
  {
    key: "momentum",
    label: "Momentum",
    hint: "Direction of travel across the trailing multi-year window.",
  },
  {
    key: "headroom",
    label: "Headroom",
    hint: "Room left once existing domestic producers are accounted for.",
  },
];

function Bar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 62
      ? "var(--positive)"
      : pct >= 42
        ? "var(--accent)"
        : "var(--muted)";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

interface ProductGap {
  hsCode: string;
  description: string;
  imports: number;
  exports: number;
  netImports: number;
  importDependency: number;
}

interface ProductState {
  status: "idle" | "loading" | "done" | "error";
  products?: ProductGap[];
  message?: string;
  lineCount?: number;
}

export function OpportunityCard({
  opportunity,
  rank,
  country,
}: {
  opportunity: Opportunity;
  rank: number;
  country: string;
}) {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<ProductState>({ status: "idle" });
  const o = opportunity;
  const observed = Boolean(o.tradeGap?.observed);
  const trend = o.tradeGap?.trendPct ?? null;

  async function loadProducts() {
    if (products.status === "loading" || products.status === "done") return;
    setProducts({ status: "loading" });
    try {
      const res = await fetch(
        `/api/products?country=${country}&segment=${o.segmentId}&year=${o.tradeGap?.year}`,
      );
      const body = await res.json();
      if (!res.ok) {
        setProducts({ status: "error", message: body.error ?? "Lookup failed" });
        return;
      }
      setProducts({
        status: "done",
        products: body.products,
        lineCount: body.lineCount,
      });
    } catch {
      setProducts({ status: "error", message: "Product lookup failed." });
    }
  }

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] font-mono text-sm text-[var(--muted)]">
          {rank}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-base font-semibold">{o.name}</h3>
            <div className="flex items-baseline gap-1.5">
              <span
                className={`font-mono text-2xl font-semibold tabular-nums ${scoreTone(o.score)}`}
              >
                {o.score.toFixed(1)}
              </span>
              <span className="text-xs text-[var(--muted)]">/100</span>
            </div>
          </div>

          <p className="mt-1 text-sm text-[var(--muted)]">{o.description}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                observed
                  ? "bg-[var(--positive)]/12 text-[var(--positive)]"
                  : "bg-[var(--warning)]/12 text-[var(--warning)]"
              }`}
              title={
                observed
                  ? "Gap measured directly from customs records."
                  : "No customs footprint; gap inferred from macro indicators."
              }
            >
              {observed ? "Observed in trade data" : "Modelled estimate"}
            </span>

            <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--muted)]">
              Confidence {(o.confidence * 100).toFixed(0)}%
            </span>

            <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--muted)]">
              ~{o.timeToRevenueMonths} mo to revenue
            </span>

            {o.addressableUsd !== null && o.addressableUsd > 0 && (
              <span className="rounded-full bg-[var(--accent)]/12 px-2 py-0.5 font-medium text-[var(--accent)]">
                {formatUsd(o.addressableUsd)}/yr addressable
              </span>
            )}

            {trend !== null && (
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  trend > 0
                    ? "bg-[var(--positive)]/12 text-[var(--positive)]"
                    : "bg-[var(--danger)]/12 text-[var(--danger)]"
                }`}
                title={
                  trend > 0
                    ? "The import gap is growing — domestic supply is falling further behind."
                    : "The import gap is shrinking — someone is already building capacity here."
                }
              >
                Gap {trend > 0 ? "widening" : "closing"}{" "}
                {trend > 0 ? "+" : ""}
                {trend.toFixed(1)}%/yr
              </span>
            )}

            {o.density && (
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  o.density.saturation > 1.25
                    ? "bg-[var(--danger)]/12 text-[var(--danger)]"
                    : "bg-[var(--positive)]/12 text-[var(--positive)]"
                }`}
                title={`${o.density.count.toLocaleString()} ${o.density.label} mapped in OpenStreetMap.`}
              >
                {o.density.saturation.toFixed(2)}x premise density
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-5">
        {COMPONENT_LABELS.map(({ key, label, hint }) => (
          <div key={key} title={hint}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium text-[var(--muted)]">
                {label}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--muted)]">
                {o.components[key].toFixed(0)}
              </span>
            </div>
            <Bar value={o.components[key]} />
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-[var(--accent)] hover:underline"
        >
          {open
            ? "Hide evidence"
            : `Why this score — ${o.evidence.length} sources`}
        </button>

        {o.hasProductDetail && (
          <button
            onClick={loadProducts}
            disabled={products.status === "loading"}
            className="text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-50"
          >
            {products.status === "loading"
              ? "Querying customs lines…"
              : products.status === "done"
                ? `Showing top ${products.products?.length ?? 0} of ${products.lineCount} product lines`
                : "Break down by product →"}
          </button>
        )}
      </div>

      {products.status === "error" && (
        <p className="mt-2 text-xs text-[var(--danger)]">{products.message}</p>
      )}

      {products.status === "done" && products.products && (
        <div className="mt-3 overflow-x-auto">
          {products.products.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No individual product lines showed a net import gap.
            </p>
          ) : (
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 font-medium">HS</th>
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 text-right font-medium">Net imports</th>
                  <th className="pb-2 text-right font-medium">Import dep.</th>
                </tr>
              </thead>
              <tbody>
                {products.products.map((p) => (
                  <tr
                    key={p.hsCode}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="py-1.5 pr-3 font-mono text-xs text-[var(--muted)]">
                      {p.hsCode}
                    </td>
                    <td className="py-1.5 pr-3">{p.description}</td>
                    <td className="py-1.5 pl-3 text-right font-mono tabular-nums">
                      {formatUsd(p.netImports)}
                    </td>
                    <td className="py-1.5 pl-3 text-right font-mono tabular-nums text-[var(--muted)]">
                      {(p.importDependency * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
          {o.evidence.map((e, i) => (
            <div key={i} className="text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{e.label}</span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  {e.provenance}
                </span>
              </div>
              <p className="mt-0.5 text-[var(--muted)]">{e.detail}</p>
              <p className="mt-0.5 text-xs text-[var(--muted)] opacity-70">
                Source: {e.source}
              </p>
            </div>
          ))}

          {o.risks.length > 0 && (
            <div className="rounded-lg bg-[var(--surface-2)] p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Risks
              </p>
              <ul className="space-y-1.5">
                {o.risks.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm text-[var(--muted)]">
                    <span className="text-[var(--danger)]">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
