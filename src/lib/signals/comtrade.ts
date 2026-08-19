/**
 * UN Comtrade connector — the sharpest signal in the system.
 *
 * The core inference: if a country imports $212M of dairy and exports $2.9M of
 * it, then roughly $212M of domestic demand is being satisfied by foreign
 * producers. That is a quantified, locatable gap — not a vibe about a market
 * "feeling underserved". Everything else in the engine is supporting evidence.
 *
 * Uses the public preview endpoint, which needs no API key. If COMTRADE_API_KEY
 * is present in the environment the authenticated endpoint is used instead,
 * which lifts the rate limits.
 */

import type { SignalBundle } from "./types";
import { put } from "./types";

const PUBLIC_BASE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS";
const AUTH_BASE = "https://comtradeapi.un.org/data/v1/get/C/A/HS";

/**
 * Comtrade reporter codes, taken from Comtrade's own reference file and
 * filtered to entities that are still current.
 *
 * Two traps live here, both of which fail silently by returning zero rows
 * rather than an error:
 *  1. Comtrade deviates from ISO/M49 — France is 251, Switzerland 757,
 *     India 699, USA 842.
 *  2. The reference file also contains dissolved entities that reuse the same
 *     ISO3. "DEU" matches both 276 (Germany) and 280 (Fed. Rep. of Germany,
 *     expired 1990). Taking the first match yields a country that stopped
 *     reporting 35 years ago and looks exactly like "no trade data".
 */
export const REPORTER_CODES: Record<string, number> = {
  ARE: 784, ARG: 32, ARM: 51, AUS: 36, BGD: 50, BHR: 48, BRA: 76, CAN: 124,
  CHE: 757, CHL: 152, CHN: 156, CIV: 384, COL: 170, CYP: 196, DEU: 276, DZA: 12,
  EGY: 818, ESP: 724, ETH: 231, FRA: 251, GBR: 826, GEO: 268, GHA: 288, GRC: 300,
  IDN: 360, IND: 699, IRQ: 368, ISR: 376, ITA: 380, JOR: 400, JPN: 392, KAZ: 398,
  KEN: 404, KOR: 410, KWT: 414, LBN: 422, LKA: 144, MAR: 504, MEX: 484, MYS: 458,
  NGA: 566, NLD: 528, NPL: 524, NZL: 554, OMN: 512, PAK: 586, PER: 604, PHL: 608,
  POL: 616, PRT: 620, QAT: 634, ROU: 642, RWA: 646, SAU: 682, SEN: 686, SGP: 702,
  SWE: 752, THA: 764, TUN: 788, TUR: 792, TZA: 834, UGA: 800, UKR: 804, USA: 842,
  UZB: 860, VNM: 704, ZAF: 710,
};

interface TradeRow {
  period: string;
  flowCode: string;
  cmdCode: string;
  primaryValue: number | null;
}

export interface TradeFlow {
  hsCode: string;
  imports: number;
  exports: number;
  year: string;
}

/**
 * Comtrade publishes with a lag and coverage varies by country, so we walk
 * backwards until a year returns usable rows rather than assuming last year.
 */
function candidateYears(currentYear: number): number[] {
  return [currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];
}

/**
 * The keyless preview endpoint allows roughly one request per second and
 * answers 429 when pushed harder. Because a 429 body contains no rows, an
 * unguarded caller cannot distinguish "rate limited" from "this country
 * reported no trade" — which silently turns a throttling problem into a
 * false finding of zero imports. Every request therefore goes through a
 * single-file queue, and 429s are retried rather than swallowed.
 */
const MIN_INTERVAL_MS = 1200;
let lastRequestAt = 0;
let requestQueue: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = requestQueue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the chain alive even if this link rejects.
  requestQueue = run.catch(() => undefined);
  return run;
}

/**
 * Remembers which reporting year actually had data per country, so repeated
 * sector views skip re-probing years that are known to be empty.
 */
const resolvedYear = new Map<string, number>();

type QueryResult =
  | { status: "ok"; rows: TradeRow[] }
  | { status: "empty" }
  | { status: "rate-limited" }
  | { status: "error"; code: number };

async function queryYear(
  reporterCode: number,
  hsCodes: string[],
  year: number,
  signal: AbortSignal,
): Promise<QueryResult> {
  const apiKey = process.env.COMTRADE_API_KEY;
  const base = apiKey ? AUTH_BASE : PUBLIC_BASE;
  const params = new URLSearchParams({
    reporterCode: String(reporterCode),
    period: String(year), // preview accepts exactly one period per request
    partnerCode: "0", // 0 = World
    cmdCode: hsCodes.join(","),
    flowCode: "M,X",
    // Pin to fully aggregated rows. Without these, richer reporters return the
    // same trade broken out by second partner, transport mode and customs
    // procedure — summing that inflates totals several-fold AND overruns the
    // 500-row preview cap. Germany's HS 8517 imports read $109B disaggregated
    // versus $27.4B aggregated. Countries that report flat (Lebanon) are
    // unaffected, which is exactly why the bug is easy to miss.
    partner2Code: "0",
    customsCode: "C00",
    motCode: "0",
  });

  const res = await throttled(() =>
    fetch(`${base}?${params}`, {
      signal,
      // Annual trade data is immutable once published; cache hard.
      next: { revalidate: 604800 },
      headers: apiKey
        ? { accept: "application/json", "Ocp-Apim-Subscription-Key": apiKey }
        : { accept: "application/json" },
    }),
  );

  if (res.status === 429) return { status: "rate-limited" };
  if (!res.ok) return { status: "error", code: res.status };

  const body = (await res.json()) as { data?: TradeRow[] };
  const rows = body.data ?? [];
  return rows.length > 0 ? { status: "ok", rows } : { status: "empty" };
}

/** One year probe, retrying through transient throttling. */
async function queryYearWithRetry(
  reporterCode: number,
  hsCodes: string[],
  year: number,
  signal: AbortSignal,
): Promise<QueryResult> {
  let result = await queryYear(reporterCode, hsCodes, year, signal);
  for (let attempt = 0; attempt < 3 && result.status === "rate-limited"; attempt++) {
    await sleep(1500 * (attempt + 1));
    result = await queryYear(reporterCode, hsCodes, year, signal);
  }
  return result;
}

/**
 * Fetch import/export values for a set of HS codes, returning one flow per
 * code. Codes with no reported trade are omitted rather than zero-filled — a
 * missing observation and a genuine zero are different facts.
 */
export async function fetchTradeFlows(
  iso3: string,
  hsCodes: string[],
  currentYear: number,
  bundle: SignalBundle,
): Promise<Map<string, TradeFlow>> {
  const flows = new Map<string, TradeFlow>();
  const reporterCode = REPORTER_CODES[iso3];

  if (!reporterCode) {
    bundle.warnings.push(
      `${iso3} is not a Comtrade reporter — trade-gap analysis unavailable, scores fall back to demand modelling.`,
    );
    return flows;
  }
  if (hsCodes.length === 0) return flows;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    let rows: TradeRow[] | null = null;
    let usedYear = 0;
    let throttledOut = false;

    // Try the year we already know reports data for this country first.
    const known = resolvedYear.get(iso3);
    const years = known
      ? [known, ...candidateYears(currentYear).filter((y) => y !== known)]
      : candidateYears(currentYear);

    for (const year of years) {
      const result = await queryYearWithRetry(
        reporterCode,
        hsCodes,
        year,
        controller.signal,
      );

      if (result.status === "ok") {
        rows = result.rows;
        usedYear = year;
        resolvedYear.set(iso3, year);
        break;
      }
      if (result.status === "rate-limited") {
        throttledOut = true;
        break;
      }
      // "empty" and "error" both mean: try an earlier year.
    }

    if (!rows) {
      bundle.warnings.push(
        throttledOut
          ? "UN Comtrade rate limit reached, so trade gaps in this sector are modelled rather than observed. Retry shortly, or set COMTRADE_API_KEY for higher limits."
          : `Comtrade returned no trade records for ${iso3} in the last four reporting years.`,
      );
      return flows;
    }

    // The preview endpoint caps at 500 rows. With aggregate pinning we expect
    // at most 2 rows per HS code, so hitting the cap means the response was
    // truncated and any total computed from it would be understated.
    if (rows.length >= 500) {
      bundle.warnings.push(
        "UN Comtrade returned a truncated result set for this sector; trade totals may be understated. Set COMTRADE_API_KEY to lift the preview row cap.",
      );
    }

    for (const row of rows) {
      const value = row.primaryValue ?? 0;
      const existing = flows.get(row.cmdCode) ?? {
        hsCode: row.cmdCode,
        imports: 0,
        exports: 0,
        year: String(usedYear),
      };
      if (row.flowCode === "M") existing.imports += value;
      if (row.flowCode === "X") existing.exports += value;
      flows.set(row.cmdCode, existing);
    }

    // Record the aggregate as a signal so the UI can cite it.
    let totalImports = 0;
    let totalExports = 0;
    for (const f of flows.values()) {
      totalImports += f.imports;
      totalExports += f.exports;
    }

    put(bundle, {
      key: `trade.imports.${hsCodes.join("_")}`,
      value: totalImports,
      unit: "USD",
      provenance: "live",
      source: "UN Comtrade — imports from world",
      period: String(usedYear),
      confidence: currentYear - usedYear <= 2 ? 0.95 : 0.75,
    });
    put(bundle, {
      key: `trade.exports.${hsCodes.join("_")}`,
      value: totalExports,
      unit: "USD",
      provenance: "live",
      source: "UN Comtrade — exports to world",
      period: String(usedYear),
      confidence: currentYear - usedYear <= 2 ? 0.95 : 0.75,
    });
  } catch (err) {
    bundle.warnings.push(
      `Comtrade request failed (${err instanceof Error ? err.message : "unknown error"}); trade gaps for this sector are modelled, not observed.`,
    );
  } finally {
    clearTimeout(timeout);
  }

  return flows;
}

export interface TradeGap {
  /** Gross imports across the segment's HS codes, USD. */
  imports: number;
  /** Gross exports, USD. */
  exports: number;
  /** imports - exports. Positive means net foreign supply into the market. */
  netImports: number;
  /**
   * 0..1. Share of the segment's traded volume that flows inward. Near 1 means
   * the country consumes this category and produces almost none of it.
   */
  importDependency: number;
  year: string;
  observed: boolean;
}

export function summariseGap(
  flows: Map<string, TradeFlow>,
  hsCodes: string[],
): TradeGap {
  let imports = 0;
  let exports = 0;
  let year = "";
  let observed = false;

  for (const code of hsCodes) {
    const flow = flows.get(code);
    if (!flow) continue;
    observed = true;
    imports += flow.imports;
    exports += flow.exports;
    year = flow.year;
  }

  const total = imports + exports;
  return {
    imports,
    exports,
    netImports: imports - exports,
    importDependency: total > 0 ? imports / total : 0,
    year,
    observed,
  };
}
