/**
 * Orchestration: turn a (country, sector) request into ranked opportunities.
 *
 * Trade codes for the whole sector are fetched in a single Comtrade call rather
 * than per segment, which keeps a sector view to two upstream requests total.
 */

import {
  COUNTRY_BY_ISO3,
  conditionsFor,
  type Country,
  type MarketConditions,
} from "../domain/countries";
import { SECTOR_BY_ID, type Sector } from "../domain/sectors";
import {
  EMPTY_TRADE_DATA,
  fetchTradeFlows,
  type TradeData,
} from "../signals/comtrade";
import { EMPTY_DENSITY, fetchDensity } from "../signals/osm";
import { fetchWorldBank } from "../signals/worldbank";
import { read, type SignalBundle } from "../signals/types";
import { scoreSegment, type Opportunity } from "./score";

export interface MacroSnapshot {
  label: string;
  value: string;
  period: string;
  source: string;
}

export interface SectorAnalysis {
  country: { iso3: string; name: string; region: string };
  sector: { id: string; name: string; icon: string; blurb: string };
  opportunities: Opportunity[];
  macro: MacroSnapshot[];
  conditions: MarketConditions;
  conditionsCurated: boolean;
  warnings: string[];
  generatedAt: string;
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
    });
  }
  return out;
}

/** Comtrade rejects very long code lists; keep the request bounded. */
function sectorHsCodes(sector: Sector): string[] {
  const codes = new Set<string>();
  for (const segment of sector.segments) {
    for (const code of segment.hsCodes) codes.add(code);
  }
  return Array.from(codes).slice(0, 24);
}

export async function analyzeSector(
  iso3: string,
  sectorId: string,
): Promise<SectorAnalysis> {
  const country: Country | undefined = COUNTRY_BY_ISO3.get(iso3);
  const sector: Sector | undefined = SECTOR_BY_ID.get(sectorId);

  if (!country) throw new Error(`Unknown country: ${iso3}`);
  if (!sector) throw new Error(`Unknown sector: ${sectorId}`);

  const currentYear = new Date().getUTCFullYear();
  const bundle = await fetchWorldBank(iso3, currentYear);
  const population = read(bundle, "population", 0);

  const hsCodes = sectorHsCodes(sector);
  const segmentIds = sector.segments.map((s) => s.id);

  // Comtrade and Overpass are unrelated upstreams, so run them concurrently:
  // the sector view costs one round trip, not two. Comtrade's own request
  // queue still serialises its internal year probes.
  const [trade, density] = await Promise.all([
    hsCodes.length > 0
      ? fetchTradeFlows(iso3, hsCodes, currentYear, bundle)
      : Promise.resolve<TradeData>(EMPTY_TRADE_DATA),
    fetchDensity(country.iso2, segmentIds, population, bundle).catch(
      () => EMPTY_DENSITY,
    ),
  ]);

  const { conditions, curated } = conditionsFor(country);

  const opportunities = sector.segments
    .map((segment) =>
      scoreSegment({
        sector,
        segment,
        bundle,
        conditions,
        conditionsCurated: curated,
        trade,
        density: density.bySegment.get(segment.id),
      }),
    )
    .sort((a, b) => b.score - a.score);

  return {
    country: { iso3: country.iso3, name: country.name, region: country.region },
    sector: {
      id: sector.id,
      name: sector.name,
      icon: sector.icon,
      blurb: sector.blurb,
    },
    opportunities,
    macro: buildMacro(bundle),
    conditions,
    conditionsCurated: curated,
    warnings: bundle.warnings,
    generatedAt: new Date().toISOString(),
  };
}
