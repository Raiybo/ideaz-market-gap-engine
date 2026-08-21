/**
 * The opportunity engine.
 *
 * Scores every segment in a sector for a given country on five components and
 * combines them into one 0-100 number. The components are deliberately kept
 * separate in the output: a 72 built from a huge unmet gap that is nearly
 * impossible to serve is a completely different proposition from a 72 built on
 * a modest gap that one person could address next quarter, and collapsing them
 * into a single figure would hide that.
 *
 * Nothing here invents data. Where an input is missing, the component falls
 * back to an explicit model and the confidence score drops accordingly.
 */

import type { Sector, Segment } from "../domain/sectors";
import type { MarketConditions } from "../domain/countries";
import { summariseGap, type TradeData, type TradeGap } from "../signals/comtrade";
import type { SegmentDensity } from "../signals/osm";
import { confidenceOver, read, type SignalBundle } from "../signals/types";
import { INDICATORS } from "../signals/worldbank";

export type Provenance = "live" | "cached" | "curated" | "modelled";

export interface Evidence {
  label: string;
  detail: string;
  source: string;
  provenance: Provenance;
}

export interface ScoreComponents {
  /** Demand visibly not being met by domestic supply. */
  unmetDemand: number;
  /** Absolute size and spending power behind that demand. */
  demandStrength: number;
  /** Whether this operator, in this country, could actually execute it. */
  feasibility: number;
  /** Direction of travel over the last several years. */
  momentum: number;
  /** Room left after accounting for incumbents. */
  headroom: number;
}

export interface Opportunity {
  segmentId: string;
  sectorId: string;
  sectorName: string;
  name: string;
  description: string;
  score: number;
  components: ScoreComponents;
  confidence: number;
  /** Estimated annual USD currently flowing to foreign or unserved supply. */
  addressableUsd: number | null;
  tradeGap: TradeGap | null;
  evidence: Evidence[];
  risks: string[];
  /** Realistic months to first revenue, surfaced for sequencing decisions. */
  timeToRevenueMonths: number;
  /** Observed premise density, where this segment is countable on the ground. */
  density: SegmentDensity | null;
  /** True when a 6-digit product breakdown can be fetched for this segment. */
  hasProductDetail: boolean;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Maps a value spanning orders of magnitude onto 0..1. */
function logScale(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min));
}

const WEIGHTS = {
  unmetDemand: 0.3,
  demandStrength: 0.22,
  feasibility: 0.22,
  momentum: 0.12,
  headroom: 0.14,
} as const;

/** Reference GDP per capita used to scale income-elastic demand. */
const REFERENCE_GDP_PC = 12000;

function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

/**
 * For segments that do not appear in customs data (services, mostly), infer a
 * deficit from structural indicators instead. Each branch names the specific
 * proxy it uses so the UI can show the reasoning rather than a bare number.
 */
function structuralDeficit(
  sector: Sector,
  bundle: SignalBundle,
  conditions: MarketConditions,
): { value: number; rationale: string } {
  switch (sector.id) {
    case "energy": {
      const reliability = conditions.gridReliability;
      return {
        value: 1 - reliability,
        rationale: `Grid reliability scored at ${(reliability * 100).toFixed(0)}%, so ${(100 - reliability * 100).toFixed(0)}% of demand for dependable power is unmet by public supply.`,
      };
    }
    case "finance": {
      const ownership = read(bundle, "accountOwnership", 55);
      return {
        value: clamp01(1 - ownership / 100),
        rationale: `${ownership.toFixed(0)}% of adults hold a financial account, leaving ${(100 - ownership).toFixed(0)}% outside the formal system.`,
      };
    }
    case "healthcare": {
      const spend = read(bundle, "healthSpend", 6);
      const elder = read(bundle, "elderShare", 8);
      const deficit = clamp01((elder / 20) * 0.6 + clamp01((10 - spend) / 10) * 0.4);
      return {
        value: deficit,
        rationale: `Health spending is ${spend.toFixed(1)}% of GDP against an ageing share of ${elder.toFixed(1)}%, indicating capacity below demographic need.`,
      };
    }
    case "education": {
      const youth = read(bundle, "youthShare", 25);
      const unemployment = read(bundle, "unemployment", 8);
      const deficit = clamp01((youth / 45) * 0.5 + (unemployment / 30) * 0.5);
      return {
        value: deficit,
        rationale: `${youth.toFixed(1)}% of the population is under 15 while unemployment runs at ${unemployment.toFixed(1)}% — a skills-to-jobs mismatch.`,
      };
    }
    case "technology": {
      const internet = read(bundle, "internetUsers", 60);
      const services = read(bundle, "servicesShare", 50);
      const deficit = clamp01((internet / 100) * 0.5 + clamp01((60 - services) / 60) * 0.5);
      return {
        value: deficit,
        rationale: `${internet.toFixed(0)}% internet penetration against a services sector at ${services.toFixed(0)}% of GDP — connected population, under-built digital economy.`,
      };
    }
    case "realestate": {
      const urban = read(bundle, "urbanShare", 60);
      const urbanTrend = read(bundle, "urbanShare.trend", 0.5);
      const deficit = clamp01((urban / 100) * 0.5 + clamp01(urbanTrend / 2) * 0.5);
      return {
        value: deficit,
        rationale: `Urban population at ${urban.toFixed(0)}% and moving ${urbanTrend >= 0 ? "up" : "down"} ${Math.abs(urbanTrend).toFixed(2)}%/yr — household formation pressure on housing stock.`,
      };
    }
    case "waste": {
      const urban = read(bundle, "urbanShare", 60);
      return {
        value: clamp01((urban / 100) * 0.6 + conditions.bureaucraticFriction * 0.4),
        rationale: `${urban.toFixed(0)}% urbanisation with weak municipal capacity leaves collection and recovery underserved.`,
      };
    }
    case "logistics":
    case "retail": {
      const internet = read(bundle, "internetUsers", 60);
      return {
        value: clamp01((internet / 100) * 0.6 + conditions.informality * 0.4),
        rationale: `${internet.toFixed(0)}% of the population is online while ${(conditions.informality * 100).toFixed(0)}% of commerce remains informal — a formalisation gap.`,
      };
    }
    case "tourism": {
      const arrivals = read(bundle, "touristArrivals", 0);
      const pop = read(bundle, "population", 1);
      const ratio = arrivals / Math.max(pop, 1);
      return {
        value: clamp01(1 - ratio),
        rationale:
          arrivals > 0
            ? `${(arrivals / 1e6).toFixed(1)}M annual arrivals against a population of ${(pop / 1e6).toFixed(1)}M — inbound capacity below comparable destinations.`
            : `No recent arrivals data published; tourism deficit is modelled from regional baselines.`,
      };
    }
    default: {
      // Generic: an under-sized sector relative to a typical economy implies
      // domestic demand leaking somewhere.
      const importsShare = read(bundle, "importsShare", 40);
      return {
        value: clamp01(importsShare / 100),
        rationale: `Imports equal ${importsShare.toFixed(0)}% of GDP, indicating demand routinely satisfied from outside the country.`,
      };
    }
  }
}

export interface ScoreInput {
  sector: Sector;
  segment: Segment;
  bundle: SignalBundle;
  conditions: MarketConditions;
  conditionsCurated: boolean;
  trade: TradeData;
  /** Supply-side saturation from mapped premises, where measurable. */
  density?: SegmentDensity;
}

export function scoreSegment(input: ScoreInput): Opportunity {
  const {
    sector,
    segment,
    bundle,
    conditions,
    conditionsCurated,
    trade,
    density,
  } = input;

  const gdp = read(bundle, "gdp", 0);
  const gdpPerCapita = read(bundle, "gdpPerCapita", 5000);
  const population = read(bundle, "population", 0);
  const gdpGrowth = read(bundle, "gdpGrowth", 1.5);

  const evidence: Evidence[] = [];
  const risks: string[] = [];

  // ---- 1. Unmet demand ----------------------------------------------------
  const gap: TradeGap | null =
    segment.hsCodes.length > 0 ? summariseGap(trade, segment.hsCodes) : null;

  let unmetDemand: number;
  let addressableUsd: number | null = null;

  if (gap && gap.observed && gap.imports > 0) {
    // Observed path: customs data tells us what is bought abroad.
    const dependency = gap.importDependency;
    const substitutable = segment.importSubstitutability;
    const magnitude = logScale(Math.max(gap.netImports, 0), 5e5, 3e9);

    let base = 0.5 * dependency * substitutable + 0.5 * magnitude;

    // A gap that is widening is worth more than a static one of equal size:
    // demand is outrunning domestic supply, so the opening is still growing.
    // A closing gap means someone is already filling it.
    if (gap.trendPct !== null) {
      const trendAdjust = clamp01((gap.trendPct + 15) / 45) - 0.5; // -0.5..+0.5
      base = clamp01(base + trendAdjust * 0.18);
    }

    unmetDemand = 100 * clamp01(base);
    addressableUsd = Math.max(gap.netImports, 0) * substitutable;

    evidence.push({
      label: "Trade gap",
      detail: `Imports ${formatUsd(gap.imports)} against exports ${formatUsd(gap.exports)} (${(dependency * 100).toFixed(0)}% import-dependent). Net ${formatUsd(gap.netImports)} leaves the country each year for goods in this category.`,
      source: `UN Comtrade, ${gap.year}`,
      provenance: "live",
    });

    if (gap.trendPct !== null && gap.trendBaseYear) {
      const widening = gap.trendPct > 0;
      evidence.push({
        label: widening ? "Gap widening" : "Gap closing",
        detail: widening
          ? `Net imports have grown ${gap.trendPct.toFixed(1)}%/yr since ${gap.trendBaseYear}. Domestic supply is falling further behind demand, so the opening is still growing.`
          : `Net imports have shrunk ${Math.abs(gap.trendPct).toFixed(1)}%/yr since ${gap.trendBaseYear}. Someone is already closing this gap — entering later means meeting them head-on.`,
        source: `UN Comtrade, ${gap.trendBaseYear} vs ${gap.year}`,
        provenance: "live",
      });
      if (!widening && gap.trendPct < -8) {
        risks.push(
          `The import gap is closing at ${Math.abs(gap.trendPct).toFixed(1)}%/yr — domestic capacity is already being built. Verify who is doing it before committing.`,
        );
      }
    }

    if (substitutable < 0.6) {
      evidence.push({
        label: "Substitution ceiling",
        detail: `Only about ${(substitutable * 100).toFixed(0)}% of this category is realistically producible locally, so the addressable slice is ${formatUsd(addressableUsd)} rather than the full import bill.`,
        source: "Segment structural model",
        provenance: "curated",
      });
    }
  } else {
    // Modelled path: no customs footprint, infer from structural indicators.
    const deficit = structuralDeficit(sector, bundle, conditions);

    // The sector-level deficit is the same for every segment beneath it, so
    // splitting the consumption pool equally would hand four segments of the
    // same sector an identical figure and an identical explanation. Engel's law
    // gives a principled split instead: at low income, staples take a larger
    // budget share and discretionary segments a smaller one, so each segment's
    // slice is weighted by its own elasticity relative to its siblings.
    const engelWeight = (seg: Segment) =>
      Math.pow(
        Math.max(gdpPerCapita, 300) / REFERENCE_GDP_PC,
        seg.incomeElasticity - 1,
      );
    const siblingWeights = sector.segments.map(engelWeight);
    const weightTotal = siblingWeights.reduce((a, b) => a + b, 0);
    const ownWeight = engelWeight(segment);
    const share =
      weightTotal > 0
        ? ownWeight / weightTotal
        : 1 / Math.max(sector.segments.length, 1);

    // A segment that is hard to stand up locally cannot capture its whole
    // slice of the deficit, which also separates siblings that share a sector.
    const reachable = clamp01(
      0.55 + 0.45 * segment.importSubstitutability - 0.3 * segment.regulatoryBurden,
    );

    unmetDemand = 100 * clamp01(deficit.value * 0.85 * (0.75 + 0.5 * reachable));

    const consumptionPool = gdp * sector.gdpShareBaseline;
    const segmentPool = consumptionPool * share;
    addressableUsd =
      segmentPool > 0 ? segmentPool * deficit.value * reachable : null;

    evidence.push({
      label: "Structural deficit",
      detail: deficit.rationale,
      source: "World Bank indicators + market conditions model",
      provenance: gdp > 0 ? "live" : "modelled",
    });

    if (gdp > 0) {
      const average = 1 / Math.max(sector.segments.length, 1);
      evidence.push({
        label: "Segment share of the sector",
        detail: `This segment carries ${(share * 100).toFixed(1)}% of the sector's modelled consumption pool against a ${(average * 100).toFixed(1)}% even split, because a demand elasticity of ${segment.incomeElasticity.toFixed(1)} at ${formatUsd(gdpPerCapita)} GDP per capita makes it ${ownWeight > weightTotal * average ? "a larger" : "a smaller"} share of household spend than its sector siblings. Only ${(reachable * 100).toFixed(0)}% of that slice is treated as reachable, after its regulatory load and how locally producible it is.`,
        source: "Engel elasticity split over the sector pool",
        provenance: "modelled",
      });
    }

    if (segment.hsCodes.length > 0) {
      evidence.push({
        label: "No customs record",
        detail:
          "Comtrade returned no usable rows for this segment's HS codes, so the gap is modelled from macro indicators rather than observed trade. Treat the figure as directional.",
        source: "UN Comtrade (empty result)",
        provenance: "modelled",
      });
    }
  }

  // ---- 2. Demand strength -------------------------------------------------
  // Engel's law: as income falls, staples take a larger budget share and
  // discretionary categories are squeezed. Elasticity drives that adjustment.
  const incomeFactor = Math.pow(
    Math.max(gdpPerCapita, 300) / REFERENCE_GDP_PC,
    segment.incomeElasticity - 1,
  );
  const marketSize = gdp * sector.gdpShareBaseline * clamp01(incomeFactor / 3);
  const sizeScore = logScale(marketSize, 5e6, 5e10);
  const populationScore = logScale(Math.max(population, 1), 3e5, 5e8);

  const demandStrength = 100 * clamp01(0.65 * sizeScore + 0.35 * populationScore);

  if (gdp > 0) {
    evidence.push({
      label: "Market size",
      detail: `${formatUsd(gdp)} GDP with a population of ${(population / 1e6).toFixed(1)}M at ${formatUsd(gdpPerCapita)} per capita. Sector baseline puts the addressable consumption pool near ${formatUsd(marketSize)}.`,
      source: "World Bank national accounts",
      provenance: "live",
    });
  }

  if (segment.incomeElasticity > 1.2 && gdpPerCapita < 6000) {
    risks.push(
      `Discretionary category (elasticity ${segment.incomeElasticity.toFixed(1)}) in a low-income market — demand is thin and drops first in a downturn.`,
    );
  }

  // ---- 3. Feasibility -----------------------------------------------------
  const capitalPenalty = segment.capitalIntensity * conditions.capitalScarcity;
  const regPenalty = segment.regulatoryBurden * conditions.bureaucraticFriction;
  const infraPenalty =
    segment.infrastructureDependency * (1 - conditions.gridReliability);
  const timePenalty = clamp01(segment.timeToRevenueMonths / 36);
  const fxPenalty =
    conditions.currencyInstability * (1 - segment.importSubstitutability) * 0.8;

  const feasibility =
    100 *
    clamp01(
      1 -
        (0.28 * capitalPenalty +
          0.22 * regPenalty +
          0.28 * infraPenalty +
          0.12 * timePenalty +
          0.1 * fxPenalty),
    );

  if (infraPenalty > 0.45) {
    risks.push(
      `Infrastructure-dependent (${(segment.infrastructureDependency * 100).toFixed(0)}%) in a market with ${(conditions.gridReliability * 100).toFixed(0)}% grid reliability — budget for private generation as a permanent cost, not a contingency.`,
    );
  }
  if (capitalPenalty > 0.45) {
    risks.push(
      `Capital-heavy in a market where financing is scarce — realistically needs equity or diaspora funding rather than bank debt.`,
    );
  }
  if (regPenalty > 0.45) {
    risks.push(
      `Licence-heavy in a high-friction bureaucracy; assume permitting adds materially to the ${segment.timeToRevenueMonths}-month runway.`,
    );
  }
  if (fxPenalty > 0.3) {
    risks.push(
      `Depends on imported inputs while the currency is unstable — margins compress on every devaluation.`,
    );
  }

  // ---- 4. Momentum --------------------------------------------------------
  const popTrend = read(bundle, "population.trend", 0.8);
  const gdpPcTrend = read(bundle, "gdpPerCapita.trend", 0);

  // The sector's own value-added trend, where national accounts carry one.
  // sector.supplyIndicator holds a World Bank indicator code, which must be
  // translated to this bundle's internal signal key before lookup.
  const sectorKey = sector.supplyIndicator
    ? INDICATORS[sector.supplyIndicator]?.key
    : undefined;
  const sectorTrend = sectorKey
    ? bundle.signals.get(`${sectorKey}.trend`)?.value
    : undefined;

  const sectorTerm =
    sectorTrend !== undefined ? clamp01((sectorTrend + 6) / 16) : 0.5;

  const momentumRaw =
    0.38 * clamp01((gdpGrowth + 3) / 10) +
    0.24 * clamp01((gdpPcTrend + 5) / 15) +
    0.18 * clamp01((popTrend + 1) / 4) +
    0.2 * sectorTerm;
  const momentum = 100 * clamp01(momentumRaw);

  evidence.push({
    label: "Momentum",
    detail:
      `GDP growth ${gdpGrowth.toFixed(1)}%, GDP per capita trending ${gdpPcTrend >= 0 ? "+" : ""}${gdpPcTrend.toFixed(1)}%/yr, population ${popTrend >= 0 ? "+" : ""}${popTrend.toFixed(1)}%/yr.` +
      (sectorTrend !== undefined
        ? ` Sector value added moving ${sectorTrend >= 0 ? "+" : ""}${sectorTrend.toFixed(1)}%/yr.`
        : " No sector-specific trend published, so that term uses a neutral prior."),
    source: "World Bank, trailing 8-year window",
    provenance: "live",
  });

  // ---- 5. Headroom (inverse saturation) -----------------------------------
  let headroom: number;
  if (gap && gap.observed && gap.imports + gap.exports > 0) {
    // Heavy exports mean a domestic industry already exists and competes.
    const exportIntensity = gap.exports / (gap.imports + gap.exports);
    headroom = 100 * clamp01(1 - exportIntensity * 1.2);
    if (exportIntensity > 0.4) {
      evidence.push({
        label: "Incumbent industry",
        detail: `Exports are ${(exportIntensity * 100).toFixed(0)}% of this category's traded volume — a domestic production base already exists and will compete on cost.`,
        source: `UN Comtrade, ${gap.year}`,
        provenance: "live",
      });
    }
  } else {
    // Informality is a proxy for fragmented, beatable competition.
    headroom = 100 * clamp01(0.4 + conditions.informality * 0.5);
  }

  // Where premises are actually countable, let observed saturation adjust the
  // estimate. Bounded to +/-22 points: the reference shares it compares
  // against are curated approximations, so this refines the structural
  // estimate rather than overriding it.
  if (density) {
    const pull = clamp01((density.saturation - 1) / 2); // 0 at parity, 1 at 3x
    const relief = clamp01((1 - density.saturation) / 1); // 0 at parity, 1 at 0x
    headroom = clamp01((headroom + (relief - pull) * 22) / 100) * 100;

    const denser = density.saturation > 1;
    evidence.push({
      label: denser ? "Already well served" : "Thin on the ground",
      detail: `${density.count.toLocaleString()} ${density.label} are mapped here — ${(density.share * 100).toFixed(1)}% of the country's mapped commercial premises, against a reference of ${(density.referenceShare * 100).toFixed(1)}%. That is ${density.saturation.toFixed(2)}x typical density${population > 0 ? `, or ${density.perMillion.toFixed(0)} per million people` : ""}.`,
      source: "OpenStreetMap via Overpass",
      provenance: "live",
    });

    if (density.saturation > 1.6) {
      risks.push(
        `This category is already ${density.saturation.toFixed(1)}x more densely served than a typical market — expect to compete on differentiation rather than availability.`,
      );
    }
  }

  // ---- Composite ----------------------------------------------------------
  const components: ScoreComponents = {
    unmetDemand,
    demandStrength,
    feasibility,
    momentum,
    headroom,
  };

  const score =
    components.unmetDemand * WEIGHTS.unmetDemand +
    components.demandStrength * WEIGHTS.demandStrength +
    components.feasibility * WEIGHTS.feasibility +
    components.momentum * WEIGHTS.momentum +
    components.headroom * WEIGHTS.headroom;

  // ---- Confidence ---------------------------------------------------------
  const signalConfidence = confidenceOver(bundle, [
    "gdp",
    "gdpPerCapita",
    "population",
    "gdpGrowth",
  ]);
  const tradeConfidence = gap?.observed ? 0.95 : 0.5;
  const conditionsConfidence = conditionsCurated ? 0.9 : 0.5;
  // An independently observed supply side is a genuine second leg to stand on.
  const densityBonus = density ? 0.05 : 0;
  const confidence = clamp01(
    signalConfidence * 0.4 +
      tradeConfidence * 0.4 +
      conditionsConfidence * 0.2 +
      densityBonus,
  );

  if (!conditionsCurated) {
    risks.push(
      "Market conditions for this country are not individually researched — grid, currency and financing assumptions use neutral defaults.",
    );
  }

  return {
    segmentId: segment.id,
    sectorId: sector.id,
    sectorName: sector.name,
    name: segment.name,
    description: segment.description,
    score: Math.round(score * 10) / 10,
    components,
    confidence: Math.round(confidence * 100) / 100,
    addressableUsd,
    tradeGap: gap,
    evidence,
    risks,
    timeToRevenueMonths: segment.timeToRevenueMonths,
    density: density ?? null,
    hasProductDetail: Boolean(gap?.observed && segment.hsCodes.length > 0),
  };
}

export { formatUsd };
