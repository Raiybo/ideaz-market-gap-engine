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

import {
  COUNTRY_BY_ISO3,
  conditionsFor,
  type MarketConditions,
} from "../domain/countries";
import { expandToProductCodes, HS_DESCRIPTIONS } from "../domain/hs";
import { SECTORS, SECTOR_BY_ID, type Sector } from "../domain/sectors";
import {
  EMPTY_TRADE_DATA,
  fetchProductGaps,
  fetchTradeFlows,
  REPORTER_CODES,
  type ProductGap,
  type TradeData,
} from "../signals/comtrade";
import { EMPTY_DENSITY, fetchDensity } from "../signals/osm";
import { fetchWorldBank } from "../signals/worldbank";
import { read } from "../signals/types";
import { buildMacro, type MacroSnapshot } from "./analyze";
import { buildPlaybook, type Playbook } from "./playbook";
import { formatUsd, scoreSegment, type Opportunity } from "./score";
import { NULL_TRACER, type Tracer } from "./trace";

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
}

export async function scanCountry(
  iso3: string,
  options: ScanOptions = {},
): Promise<CountryScan> {
  const { sectorId, tracer = NULL_TRACER, drillDown = true } = options;
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
  const { conditions, curated } = conditionsFor(country);
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
    let addressable = 0;

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
      addressable += opportunity.addressableUsd ?? 0;

      tracer.status(segmentNodeId, opportunity.tradeGap?.observed ? "ok" : "empty", {
        weight: opportunity.score,
        detail: `${opportunity.score.toFixed(1)} · ${playbook.routeName}${
          opportunity.addressableUsd
            ? ` · ${formatUsd(opportunity.addressableUsd)} addressable`
            : ""
        }`,
      });
    }

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
    const targets = findings
      .filter((f) => f.hasProductDetail)
      .slice(0, DRILL_DOWN_TOP_N);

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
    warnings: bundle.warnings,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
  };
}
