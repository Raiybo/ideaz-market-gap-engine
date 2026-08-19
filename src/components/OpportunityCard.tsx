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

export function OpportunityCard({
  opportunity,
  rank,
}: {
  opportunity: Opportunity;
  rank: number;
}) {
  const [open, setOpen] = useState(false);
  const o = opportunity;
  const observed = Boolean(o.tradeGap?.observed);

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

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-4 text-xs font-medium text-[var(--accent)] hover:underline"
      >
        {open ? "Hide evidence" : `Why this score — ${o.evidence.length} sources`}
      </button>

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
