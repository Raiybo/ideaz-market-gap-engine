"use client";

import { useState } from "react";

import { GapSurvey } from "@/components/GapSurvey";
import type { MarketConditions } from "@/lib/domain/countries";
import { ALL_SEGMENTS } from "@/lib/domain/sectors";
import type { CountryScan, Finding } from "@/lib/engine/scan";
import type { Opportunity } from "@/lib/engine/score";
import { toggleWatch, useIsWatched } from "@/lib/watchlist";

function formatUsd(value: number): string {
  // Net trade flows go negative for a net exporter. Comparing a negative
  // against the magnitude thresholds fails every one of them and falls through
  // to raw digits, which is how "$-4542071604" reached the page.
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${sign}$${(v / 1e3).toFixed(0)}K`;
  return `${sign}$${v.toFixed(0)}`;
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

interface NewsArticle {
  title: string;
  url: string;
  domain: string;
  seenAt: string;
}

interface NewsState {
  status: "idle" | "loading" | "done" | "error";
  articles?: NewsArticle[];
  capacity?: NewsArticle[];
  message?: string;
  signal?: string;
}

interface ProductState {
  status: "idle" | "loading" | "done" | "error";
  products?: ProductGap[];
  message?: string;
  lineCount?: number;
}

/** Route badges carry a colour so the entry strategy is readable at a glance. */
const ROUTE_TONE: Record<string, string> = {
  substitute: "var(--positive)",
  "finish-local": "var(--accent)",
  distribute: "var(--accent)",
  export: "var(--positive)",
  service: "var(--accent)",
  formalise: "var(--warning)",
  differentiate: "var(--warning)",
};

export function FindingCard({
  finding,
  rank,
  country,
  showSector,
  conditions,
  scan,
}: {
  finding: Finding;
  rank: number;
  country: string;
  showSector: boolean;
  /**
   * Absent on the idea-assessment path, where the reader has already chosen
   * what they are building. Without it the card falls back to the plan alone.
   */
  conditions?: MarketConditions;
  /** Present on the scan path only; carries the field and country context a
      saved angle needs. */
  scan?: CountryScan;
}) {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<ProductState>({ status: "idle" });
  const [news, setNews] = useState<NewsState>({ status: "idle" });
  const o = finding;
  const watched = useIsWatched(country, o.segmentId);

  async function loadNews() {
    if (news.status === "loading") return;
    setNews({ status: "loading" });
    try {
      const res = await fetch(
        `/api/news?country=${country}&segment=${o.segmentId}`,
      );
      const body = await res.json();
      if (!res.ok) {
        setNews({ status: "error", message: body.error ?? "Lookup failed" });
        return;
      }
      setNews({
        status: "done",
        articles: body.articles ?? [],
        capacity: body.capacity ?? [],
        message: body.message ?? "",
        signal: body.status,
      });
    } catch {
      setNews({ status: "error", message: "News lookup failed." });
    }
  }
  const play = finding.playbook;
  // Looked up rather than drilled through the page: the card already knows the
  // segment id, and the taxonomy is a static import on both sides.
  const segment = ALL_SEGMENTS.find(
    (s) => s.segment.id === finding.segmentId,
  )?.segment;
  const tone = ROUTE_TONE[play.route] ?? "var(--accent)";
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
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-base font-semibold">{o.name}</h3>
              {showSector && (
                <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
                  {o.sectorName}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  toggleWatch({
                    segmentId: o.segmentId,
                    countryIso3: country,
                    countryName: country,
                    segmentName: o.name,
                    sectorName: o.sectorName,
                    score: o.score,
                    addressableUsd: o.addressableUsd,
                  })
                }
                title={
                  watched
                    ? "Saved — the score at save time is kept so later scans can show the movement"
                    : "Save this finding and track how its score moves"
                }
                className={`rounded-md px-1.5 py-0.5 text-sm transition-colors ${
                  watched
                    ? "text-[var(--warning)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
                aria-pressed={watched}
              >
                {watched ? "★" : "☆"}
              </button>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={`font-mono text-2xl font-semibold tabular-nums ${scoreTone(o.score)}`}
                >
                  {o.score.toFixed(1)}
                </span>
                <span className="text-xs text-[var(--muted)]">/100</span>
              </div>
            </div>
          </div>

          <p className="mt-1 text-sm text-[var(--muted)]">{o.description}</p>

          {/* What was found, in one line then in full. */}
          <p className="mt-3 text-sm font-medium leading-snug">
            {play.headline}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
            {play.finding}
          </p>

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

      {/* ---- The play ------------------------------------------------------
          A gap is not an opportunity until there is a way in. This block is
          the answer to "so what do I actually do", sized in money and time. */}
      <section
        className="mt-4 rounded-lg border p-4"
        style={{ borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`, background: `color-mix(in srgb, ${tone} 6%, transparent)` }}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }}
          >
            {play.routeName}
          </span>
          <span className="font-mono text-xs text-[var(--muted)]">
            {play.capital.label} to start
          </span>
          <span className="font-mono text-xs text-[var(--muted)]">
            ~{play.timeToRevenueMonths} mo to first revenue
          </span>
        </div>

        <p className="mt-2.5 text-sm leading-relaxed">{play.thesis}</p>

        {play.revenueMath.length > 0 && (
          <ul className="mt-3 space-y-1">
            {play.revenueMath.map((line, i) => (
              <li
                key={i}
                className="font-mono text-xs tabular-nums text-[var(--muted)]"
              >
                {line}
              </li>
            ))}
          </ul>
        )}

        {finding.beachhead && (
          <div className="mt-3 rounded-md bg-[var(--surface-2)] p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Start with one line, not the category
            </p>
            <p className="mt-1 text-sm">
              <span className="font-mono text-xs text-[var(--muted)]">
                HS {finding.beachhead.hsCode}
              </span>{" "}
              {finding.beachhead.description}
            </p>
            <p className="mt-1 font-mono text-xs tabular-nums text-[var(--muted)]">
              {formatUsd(finding.beachhead.netImports)} net imports ·{" "}
              {(finding.beachhead.importDependency * 100).toFixed(0)}% import
              dependent — the largest single gap inside this segment.
            </p>
          </div>
        )}
      </section>

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
            ? "Hide the plan"
            : `Find my angle — 5 questions, then the plan (${o.evidence.length} sources)`}
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

        <button
          onClick={loadNews}
          disabled={news.status === "loading"}
          className="text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-50"
          title="Search news published in this country for signs that someone is already building capacity here"
        >
          {news.status === "loading"
            ? "Searching recent news…"
            : news.status === "done"
              ? `News checked — ${news.capacity?.length ?? 0} capacity signals`
              : "Check recent news →"}
        </button>
      </div>

      {news.status === "error" && (
        <p className="mt-2 text-xs text-[var(--danger)]">{news.message}</p>
      )}

      {news.status === "done" && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <p className="text-xs text-[var(--muted)]">{news.message}</p>
          {(news.capacity?.length ?? 0) > 0 && (
            <div className="mt-2.5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--danger)]">
                Reads as new capacity being built
              </p>
              <ul className="space-y-1.5">
                {news.capacity!.slice(0, 5).map((a) => (
                  <li key={a.url} className="text-sm">
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[var(--accent)] hover:underline"
                    >
                      {a.title}
                    </a>
                    <span className="ml-2 font-mono text-[10px] text-[var(--muted)]">
                      {a.domain} · {a.seenAt.slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(news.articles?.length ?? 0) > 0 &&
            (news.capacity?.length ?? 0) === 0 && (
              <ul className="mt-2 space-y-1">
                {news.articles!.slice(0, 4).map((a) => (
                  <li key={a.url} className="truncate text-sm">
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[var(--muted)] hover:text-[var(--accent)] hover:underline"
                    >
                      {a.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}

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

      {open && segment && conditions && (
        <GapSurvey
          playbook={play}
          segment={segment}
          conditions={conditions}
          physical={segment.hsCodes.length > 0}
          segmentName={o.name}
          scan={scan}
          finding={finding}
        />
      )}

      {open && (
        <div className="mt-3 space-y-4 border-t border-[var(--border)] pt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                First moves
              </p>
              <ol className="space-y-1.5">
                {play.firstMoves.map((move, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="font-mono text-xs text-[var(--muted)]">
                      {i + 1}.
                    </span>
                    <span className="text-[var(--muted)]">{move}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Cheapest way to prove it wrong
                </p>
                <p className="text-sm text-[var(--muted)]">{play.provingTest}</p>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Who pays
                </p>
                <ul className="space-y-1">
                  {play.buyers.map((b, i) => (
                    <li key={i} className="flex gap-2 text-sm text-[var(--muted)]">
                      <span style={{ color: tone }}>•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Capital
                </p>
                <p className="text-sm text-[var(--muted)]">
                  <span className="font-mono">{play.capital.label}</span> —{" "}
                  {play.capital.rationale}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Evidence
            </p>
            <div className="space-y-3">
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

            </div>
          </div>

          {play.killers.length > 0 && (
            <div className="rounded-lg bg-[var(--surface-2)] p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                What kills it
              </p>
              <ul className="space-y-1.5">
                {play.killers.map((r, i) => (
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
