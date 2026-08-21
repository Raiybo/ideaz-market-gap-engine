/**
 * Whole-country scan.
 *
 * The sector view answers "which segment of food and beverage". This answers
 * the question someone actually arrives with: "where is there money to be made
 * in this country at all". It scores every segment of every sector and ranks
 * them against each other, then attaches an entry route to each result so a
 * finding arrives as a business rather than a statistic.
 *
 * The reason this is affordable is that the taxonomy is narrower than it looks:
 * 16 sectors reference 68 distinct HS codes between them, which the connector
 * fetches in a single chunked request. Scanning every sector costs the same two
 * Comtrade round trips as scanning one, so the expensive-looking option is
 * actually the cheap one.
 */

import { resolveConditions, type ConditionField } from "../domain/conditions";
import { COUNTRY_BY_ISO3, type MarketConditions } from "../domain/countries";
import { expandToProductCodes, HS_DESCRIPTIONS } from "../domain/hs";
import { SECTORS, SECTOR_BY_ID, type Sector } from "../domain/sectors";
import {
  EMPTY_TRADE_DATA,
  fetchProductGaps,
  fetchTradeFlows,
  REPORTER_CODES,
  summariseGap,
  type ProductGap,
  type TradeData,
} from "../signals/comtrade";
import { EMPTY_DENSITY, fetchDensity } from "../signals/osm";
import { fetchWorldBank } from "../signals/worldbank";
import { read, type SignalBundle } from "../signals/types";

import { buildPlaybook, type Playbook } from "./playbook";
import { formatUsd, scoreSegment, type Opportunity } from "./score";
import { NULL_TRACER, type Tracer } from "./trace";

export interface MacroSnapshot {
  label: string;
  value: string;
  period: string;
  source: string;
  /** Source registry id, so the UI can link the figure to its publisher. */
  sourceId: string;
}

function formatNumber(value: number, unit: string): string {
  if (unit === "USD") {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    return `$${value.toFixed(0)}`;
  }
  if (unit === "people" || unit === "arrivals") {
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
    return value.toFixed(0);
  }
  if (unit.startsWith("%")) return `${value.toFixed(1)}%`;
  return value.toFixed(1);
}

const MACRO_KEYS: Array<{ key: string; label: string }> = [
  { key: "gdp", label: "GDP" },
  { key: "gdpPerCapita", label: "GDP per capita" },
  { key: "population", label: "Population" },
  { key: "gdpGrowth", label: "GDP growth" },
  { key: "inflation", label: "Inflation" },
  { key: "unemployment", label: "Unemployment" },
  { key: "importsShare", label: "Imports (% GDP)" },
  { key: "remittances", label: "Remittances (% GDP)" },
];

function buildMacro(bundle: SignalBundle): MacroSnapshot[] {
  const out: MacroSnapshot[] = [];
  for (const { key, label } of MACRO_KEYS) {
    const signal = bundle.signals.get(key);
    if (!signal) continue;
    out.push({
      label,
      value: formatNumber(signal.value, signal.unit),
      period: signal.period ?? "—",
      source: signal.source,
      sourceId: "worldbank",
    });
  }
  return out;
}


export interface Finding extends Opportunity {
  playbook: Playbook;
  /** The single largest product line inside the segment, where measurable. */
  beachhead: ProductGap | null;
}

export interface SectorRollup {
  id: string;
  name: string;
  icon: string;
  bestScore: number;
  segmentCount: number;
  /** Total annual USD the sector's segments leave on the table, where observed. */
  addressableUsd: number;
}

export interface CountryScan {
  country: { iso3: string; iso2: string; name: string; region: string };
  scope: "country" | "sector";
  sector: { id: string; name: string; icon: string; blurb: string } | null;
  findings: Finding[];
  sectors: SectorRollup[];
  macro: MacroSnapshot[];
  conditions: MarketConditions;
  conditionsCurated: boolean;
  /** Per-dimension provenance, so each condition can cite its own source. */
  conditionFields: ConditionField[];
  warnings: string[];
  generatedAt: string;
  /** Wall-clock cost of the scan, so the cache saving is visible. */
  elapsedMs: number;
}

/** How many top findings get a product-level beachhead fetched. */
const DRILL_DOWN_TOP_N = 3;

export interface ScanOptions {
  /** Restrict to one sector. Omit to scan the whole country. */
  sectorId?: string;
  tracer?: Tracer;
  /** Fetch the largest product line for the top findings. */
  drillDown?: boolean;
  /**
   * Segments that must get a product-level beachhead regardless of where they
   * rank. The idea assessment needs one for the segment the user actually
   * asked about, which is frequently not in the top three.
   */
  drillSegments?: string[];
}

/**
 * Sector-level addressable value, without double counting.
 *
 * Segments inside a sector routinely claim overlapping customs codes — apparel
 * manufacturing and apparel brands both declare chapters 61 and 62, and food
 * processing declares chapter 19 while bakery declares 1905 beneath it. Summing
 * each segment's own figure therefore counts the same trade more than once, and
 * did: Textiles read roughly double its true total.
 *
 * The fix is to reduce the sector's codes to a non-overlapping set, value each
 * one once at the most optimistic substitutability any claiming segment gives
 * it, and add the modelled segments separately — those have no customs
 * footprint, so they cannot overlap with anything.
 */
function sectorAddressable(
  sector: Sector,
  trade: TradeData,
  opportunities: Opportunity[],
): number {
  const declared = new Set<string>();
  for (const segment of sector.segments) {
    for (const code of segment.hsCodes) declared.add(code);
  }

  // Shortest first, so a broader chapter absorbs the lines beneath it.
  const sorted = Array.from(declared).sort((a, b) => a.length - b.length);
  const distinct: string[] = [];
  for (const code of sorted) {
    if (!distinct.some((kept) => code.startsWith(kept))) distinct.push(code);
  }

  let total = 0;
  for (const code of distinct) {
    const gap = summariseGap(trade, [code]);
    if (!gap.observed || gap.netImports <= 0) continue;
    const claimants = sector.segments.filter((segment) =>
      segment.hsCodes.some((c) => code.startsWith(c) || c.startsWith(code)),
    );
    const substitutability = claimants.reduce(
      (max, segment) => Math.max(max, segment.importSubstitutability),
      0,
    );
    total += gap.netImports * substitutability;
  }

  // Segments with no customs footprint are additive by construction.
  for (const opportunity of opportunities) {
    if (!opportunity.tradeGap?.observed) total += opportunity.addressableUsd ?? 0;
  }

  return total;
}

export async function scanCountry(
  iso3: string,
  options: ScanOptions = {},
): Promise<CountryScan> {
  const {
    sectorId,
    tracer = NULL_TRACER,
    drillDown = true,
    drillSegments = [],
  } = options;
  const startedAt = Date.now();

  const country = COUNTRY_BY_ISO3.get(iso3);
  if (!country) throw new Error(`Unknown country: ${iso3}`);

  const sectors: Sector[] = sectorId
    ? [SECTOR_BY_ID.get(sectorId)].filter((s): s is Sector => Boolean(s))
    : SECTORS;
  if (sectorId && sectors.length === 0) {
    throw new Error(`Unknown sector: ${sectorId}`);
  }

  const countryNodeId = `country:${iso3}`;
  tracer.node({
    id: countryNodeId,
    kind: "country",
    label: country.name,
    detail: `${country.region} · scanning ${sectors.length} sector${sectors.length === 1 ? "" : "s"}`,
    status: "active",
  });

  // ---- Signals ------------------------------------------------------------
  tracer.phase("Reading the market");
  const currentYear = new Date().getUTCFullYear();
  const bundle = await fetchWorldBank(iso3, currentYear, tracer);
  const population = read(bundle, "population", 0);

  const hsCodes = Array.from(
    new Set(sectors.flatMap((s) => s.segments.flatMap((seg) => seg.hsCodes))),
  );
  const segmentIds = sectors.flatMap((s) => s.segments.map((seg) => seg.id));

  tracer.phase("Measuring what crosses the border");
  const [trade, density] = await Promise.all([
    hsCodes.length > 0
      ? fetchTradeFlows(iso3, hsCodes, currentYear, bundle, tracer)
      : Promise.resolve<TradeData>(EMPTY_TRADE_DATA),
    fetchDensity(
      country.iso2,
      segmentIds,
      population,
      bundle,
      tracer,
      countryNodeId,
    ).catch(() => EMPTY_DENSITY),
  ]);

  // ---- Scoring ------------------------------------------------------------
  tracer.phase("Scoring every segment");
  const {
    conditions,
    curated,
    fields: conditionFields,
    measuredCount,
  } = resolveConditions(country, bundle, currentYear);
  tracer.note(
    `${measuredCount} of 6 operating conditions derived from published indicators; the rest are researched constants.`,
  );
  const gdpPerCapita = read(bundle, "gdpPerCapita", 5000);

  const findings: Finding[] = [];
  const rollups: SectorRollup[] = [];

  for (const sector of sectors) {
    const sectorNodeId = `sector:${sector.id}`;
    tracer.node({
      id: sectorNodeId,
      kind: "sector",
      label: sector.name,
      parent: countryNodeId,
      detail: `${sector.segments.length} segments`,
      status: "active",
    });

    let bestScore = 0;
    const sectorOpportunities: Opportunity[] = [];

    for (const segment of sector.segments) {
      const segmentNodeId = `segment:${segment.id}`;
      tracer.node({
        id: segmentNodeId,
        kind: "segment",
        label: segment.name,
        parent: sectorNodeId,
        status: "active",
      });

      const opportunity = scoreSegment({
        sector,
        segment,
        bundle,
        conditions,
        conditionsCurated: curated,
        trade,
        density: density.bySegment.get(segment.id),
      });

      const playbook = buildPlaybook({
        opportunity,
        segment,
        sector,
        conditions,
        countryName: country.name,
        gdpPerCapita,
      });

      findings.push({ ...opportunity, playbook, beachhead: null });

      bestScore = Math.max(bestScore, opportunity.score);
      sectorOpportunities.push(opportunity);

      tracer.status(segmentNodeId, opportunity.tradeGap?.observed ? "ok" : "empty", {
        weight: opportunity.score,
        detail: `${opportunity.score.toFixed(1)} · ${playbook.routeName}${
          opportunity.addressableUsd
            ? ` · ${formatUsd(opportunity.addressableUsd)} addressable`
            : ""
        }`,
      });
    }

    const addressable = sectorAddressable(sector, trade, sectorOpportunities);

    rollups.push({
      id: sector.id,
      name: sector.name,
      icon: sector.icon,
      bestScore: Math.round(bestScore * 10) / 10,
      segmentCount: sector.segments.length,
      addressableUsd: addressable,
    });

    tracer.status(sectorNodeId, "ok", {
      weight: bestScore,
      detail: `Best segment scores ${bestScore.toFixed(1)}; ${formatUsd(addressable)} addressable across the sector`,
    });
  }

  findings.sort((a, b) => b.score - a.score);
  rollups.sort((a, b) => b.bestScore - a.bestScore);

  // ---- Beachhead drill-down ----------------------------------------------
  // Only for the leaders: this is the one part of the scan that costs an extra
  // request per segment, so it is spent where a decision would actually be made.
  if (drillDown && trade.currentYear && REPORTER_CODES[iso3]) {
    tracer.phase("Finding the way in");
    const forced = new Set(drillSegments);
    const eligible = findings.filter((f) => f.hasProductDetail);
    const targets = [
      ...eligible.filter((f) => forced.has(f.segmentId)),
      ...eligible
        .filter((f) => !forced.has(f.segmentId))
        .slice(0, DRILL_DOWN_TOP_N),
    ];

    for (const finding of targets) {
      const sector = sectors.find((s) => s.id === finding.sectorId);
      const segment = sector?.segments.find((sg) => sg.id === finding.segmentId);
      if (!segment) continue;

      const nodeId = `beachhead:${finding.segmentId}`;
      tracer.node({
        id: nodeId,
        kind: "finding",
        label: `Beachhead — ${finding.name}`,
        parent: `segment:${finding.segmentId}`,
        detail: "Resolving the largest single product line",
        status: "active",
      });

      try {
        const products = await fetchProductGaps(
          iso3,
          expandToProductCodes(segment.hsCodes),
          HS_DESCRIPTIONS,
          trade.currentYear,
          bundle,
        );
        const top = products[0] ?? null;
        finding.beachhead = top;

        if (top) {
          tracer.status(nodeId, "ok", {
            weight: finding.score,
            detail: `HS ${top.hsCode} — ${formatUsd(top.netImports)} net imports at ${(top.importDependency * 100).toFixed(0)}% dependency`,
          });
        } else {
          tracer.status(nodeId, "empty", {
            detail: "No single line stands out inside this category",
          });
        }
      } catch {
        tracer.status(nodeId, "error", { detail: "Product lookup failed" });
      }
    }
  }

  tracer.status(countryNodeId, "ok", {
    detail: `${findings.length} segments scored; top opportunity ${findings[0]?.score.toFixed(1) ?? "n/a"}`,
  });

  const activeSector = sectorId ? SECTOR_BY_ID.get(sectorId) : undefined;

  return {
    country: {
      iso3: country.iso3,
      iso2: country.iso2,
      name: country.name,
      region: country.region,
    },
    scope: sectorId ? "sector" : "country",
    sector: activeSector
      ? {
          id: activeSector.id,
          name: activeSector.name,
          icon: activeSector.icon,
          blurb: activeSector.blurb,
        }
      : null,
    findings,
    sectors: rollups,
    macro: buildMacro(bundle),
    conditions,
    conditionsCurated: curated,
    conditionFields,
    warnings: bundle.warnings,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
  };
}
