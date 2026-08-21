/**
 * World Bank Open Data connector.
 *
 * Free, key-less, and the most reliable cross-country macro source available.
 * Each indicator is fetched as a time series so the engine can compute both a
 * level (latest non-null observation) and a trend (CAGR), which is what turns
 * "this market is big" into "this market is big and growing".
 */

import { NULL_TRACER, type Tracer } from "../engine/trace";
import { makeBundle, put, type SignalBundle } from "./types";

const WB_BASE = "https://api.worldbank.org/v2";

/** Indicator code -> internal signal key. */
export const INDICATORS: Record<string, { key: string; unit: string; label: string }> = {
  "SP.POP.TOTL": { key: "population", unit: "people", label: "Population" },
  "NY.GDP.PCAP.CD": { key: "gdpPerCapita", unit: "USD", label: "GDP per capita" },
  "NY.GDP.MKTP.CD": { key: "gdp", unit: "USD", label: "GDP" },
  "NY.GDP.MKTP.KD.ZG": { key: "gdpGrowth", unit: "%", label: "GDP growth" },
  "NV.IND.MANF.ZS": { key: "manufacturingShare", unit: "% of GDP", label: "Manufacturing value added" },
  "NV.AGR.TOTL.ZS": { key: "agricultureShare", unit: "% of GDP", label: "Agriculture value added" },
  "NV.IND.TOTL.ZS": { key: "industryShare", unit: "% of GDP", label: "Industry value added" },
  "NV.SRV.TOTL.ZS": { key: "servicesShare", unit: "% of GDP", label: "Services value added" },
  "NE.IMP.GNFS.ZS": { key: "importsShare", unit: "% of GDP", label: "Imports of goods & services" },
  "NE.EXP.GNFS.ZS": { key: "exportsShare", unit: "% of GDP", label: "Exports of goods & services" },
  "SP.URB.TOTL.IN.ZS": { key: "urbanShare", unit: "% of population", label: "Urban population" },
  "IT.NET.USER.ZS": { key: "internetUsers", unit: "% of population", label: "Internet users" },
  "SL.UEM.TOTL.ZS": { key: "unemployment", unit: "% of labour force", label: "Unemployment" },
  "SP.POP.0014.TO.ZS": { key: "youthShare", unit: "% of population", label: "Population aged 0-14" },
  "SP.POP.65UP.TO.ZS": { key: "elderShare", unit: "% of population", label: "Population aged 65+" },
  "FP.CPI.TOTL.ZG": { key: "inflation", unit: "%", label: "Consumer price inflation" },
  "SH.XPD.CHEX.GD.ZS": { key: "healthSpend", unit: "% of GDP", label: "Health expenditure" },
  "SE.XPD.TOTL.GD.ZS": { key: "educationSpend", unit: "% of GDP", label: "Government education expenditure" },
  "EG.USE.ELEC.KH.PC": { key: "electricityPerCapita", unit: "kWh", label: "Electric power consumption" },
  "ST.INT.ARVL": { key: "touristArrivals", unit: "arrivals", label: "International tourist arrivals" },
  "FX.OWN.TOTL.ZS": { key: "accountOwnership", unit: "% aged 15+", label: "Financial account ownership" },
  "BX.TRF.PWKR.DT.GD.ZS": { key: "remittances", unit: "% of GDP", label: "Personal remittances received" },
  "SP.DYN.TFRT.IN": { key: "fertility", unit: "births per woman", label: "Fertility rate" },
  // Added to derive operating conditions from measurement rather than
  // judgement wherever the data supports it. See domain/conditions.ts for
  // which dimensions this actually makes possible and which it does not.
  "PA.NUS.FCRF": { key: "exchangeRate", unit: "LCU per USD", label: "Official exchange rate" },
  "FS.AST.PRVT.GD.ZS": { key: "privateCredit", unit: "% of GDP", label: "Domestic credit to private sector" },
  "EG.ELC.ACCS.ZS": { key: "electricityAccess", unit: "% of population", label: "Access to electricity" },
};

interface WBObservation {
  date: string;
  value: number | null;
}

/**
 * How stale an observation may be before we discount it. World Bank data lags
 * by 1-3 years routinely, so we only start penalising past that.
 */
function confidenceForAge(year: number, now: number): number {
  const age = now - year;
  if (age <= 2) return 0.95;
  if (age <= 4) return 0.85;
  if (age <= 7) return 0.65;
  if (age <= 12) return 0.4;
  return 0.25;
}

/**
 * Per-indicator timeout.
 *
 * These are fetched concurrently, and a single shared AbortController means one
 * slow indicator aborts all of them — which is exactly how a healthy country
 * comes back reporting "26 of 26 indicators did not return data". Each request
 * gets its own deadline so a straggler costs one indicator, not the set.
 */
const INDICATOR_TIMEOUT_MS = 20000;

async function fetchIndicator(
  iso3: string,
  indicator: string,
): Promise<WBObservation[] | null> {
  const url = `${WB_BASE}/country/${iso3}/indicator/${indicator}?format=json&per_page=40&date=2005:2025`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(INDICATOR_TIMEOUT_MS),
    // Macro indicators update at most a few times a year; a day of cache is
    // generous and keeps the page fast without going stale in any real sense.
    next: { revalidate: 86400 },
    headers: { accept: "application/json" },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body) || body.length < 2 || !Array.isArray(body[1])) {
    return null;
  }
  return (body[1] as Array<{ date: string; value: number | null }>).map((o) => ({
    date: o.date,
    value: o.value,
  }));
}

/** Compound annual growth rate between the oldest and newest usable points. */
function computeTrend(series: WBObservation[]): number | null {
  const points = series
    .filter((o): o is { date: string; value: number } => o.value !== null)
    .map((o) => ({ year: Number(o.date), value: o.value }))
    .filter((o) => Number.isFinite(o.year))
    .sort((a, b) => a.year - b.year);

  if (points.length < 3) return null;

  // Use a recent window so a 2008 collapse does not define a 2024 trend.
  const recent = points.slice(-8);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const years = last.year - first.year;
  if (years <= 0 || first.value <= 0 || last.value <= 0) return null;

  return (Math.pow(last.value / first.value, 1 / years) - 1) * 100;
}

export async function fetchWorldBank(
  iso3: string,
  currentYear: number,
  tracer: Tracer = NULL_TRACER,
): Promise<SignalBundle> {
  const bundle = makeBundle(iso3);

  tracer.node({
    id: "src:worldbank",
    kind: "source",
    label: "World Bank",
    parent: `country:${iso3}`,
    detail: `${Object.keys(INDICATORS).length} macro indicators, level and trend`,
    status: "active",
  });

  try {
    const codes = Object.keys(INDICATORS);
    for (const code of codes) {
      tracer.node({
        id: `sig:${INDICATORS[code].key}`,
        kind: "signal",
        label: INDICATORS[code].label,
        parent: "src:worldbank",
        status: "active",
      });
    }

    const results = await Promise.allSettled(
      codes.map((code) => fetchIndicator(iso3, code)),
    );

    let failures = 0;

    results.forEach((result, i) => {
      const code = codes[i];
      const meta = INDICATORS[code];

      if (result.status === "rejected" || result.value === null) {
        failures += 1;
        tracer.status(`sig:${meta.key}`, "error", {
          detail: "Indicator request failed",
        });
        return;
      }

      const series = result.value;
      const latest = series
        .filter((o): o is { date: string; value: number } => o.value !== null)
        .sort((a, b) => Number(b.date) - Number(a.date))[0];

      if (!latest) {
        bundle.warnings.push(`No ${meta.label} data published for this country.`);
        tracer.status(`sig:${meta.key}`, "empty", {
          detail: "No observation published for this country",
        });
        return;
      }

      const year = Number(latest.date);
      put(bundle, {
        key: meta.key,
        value: latest.value,
        unit: meta.unit,
        provenance: "live",
        source: `World Bank — ${meta.label}`,
        period: latest.date,
        confidence: confidenceForAge(year, currentYear),
      });

      tracer.status(`sig:${meta.key}`, "ok", {
        detail: `${latest.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${meta.unit} (${latest.date})`,
      });

      const trend = computeTrend(series);
      if (trend !== null) {
        put(bundle, {
          key: `${meta.key}.trend`,
          value: trend,
          unit: "% CAGR",
          provenance: "live",
          source: `World Bank — ${meta.label} (trend)`,
          period: `${year - 7}-${year}`,
          confidence: confidenceForAge(year, currentYear) * 0.9,
        });
      }
    });

    if (failures > 0) {
      bundle.warnings.push(
        `${failures} of ${codes.length} World Bank indicators did not return data.`,
      );
    }

    tracer.status("src:worldbank", failures === codes.length ? "error" : "ok", {
      detail: `${codes.length - failures} of ${codes.length} indicators resolved`,
    });
  } catch (err) {
    bundle.warnings.push(
      `World Bank API unreachable (${err instanceof Error ? err.message : "unknown error"}). Scores fall back to modelled estimates.`,
    );
    tracer.status("src:worldbank", "error", { detail: "API unreachable" });
  }

  return bundle;
}
