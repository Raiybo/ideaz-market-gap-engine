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

import { NULL_TRACER, type Tracer } from "../engine/trace";
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
 *
 * A subscription key buys a much higher ceiling, and holding keyed traffic to
 * the keyless pace made the key worthless: it changed which endpoint we call
 * without changing how fast we could call it. Eight consecutive keyed requests
 * at 3.3/s all returned 200, and UN Comtrade documents 5/s for its premium
 * tier, so 2.5/s leaves real headroom while roughly tripling scan throughput.
 * Both paths keep the same queue and the same 429 handling, so if the ceiling
 * turns out to be lower than measured the retry path still covers us.
 */
const KEYLESS_INTERVAL_MS = 1200;
const KEYED_INTERVAL_MS = 400;

function minInterval(): number {
  return process.env.COMTRADE_API_KEY ? KEYED_INTERVAL_MS : KEYLESS_INTERVAL_MS;
}

let lastRequestAt = 0;
let requestQueue: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = requestQueue.then(async () => {
    const wait = minInterval() - (Date.now() - lastRequestAt);
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

/** Fold raw Comtrade rows into one import/export pair per HS code. */
function rowsToFlows(rows: TradeRow[], year: number): Map<string, TradeFlow> {
  const flows = new Map<string, TradeFlow>();
  for (const row of rows) {
    const value = row.primaryValue ?? 0;
    const existing = flows.get(row.cmdCode) ?? {
      hsCode: row.cmdCode,
      imports: 0,
      exports: 0,
      year: String(year),
    };
    if (row.flowCode === "M") existing.imports += value;
    if (row.flowCode === "X") existing.exports += value;
    flows.set(row.cmdCode, existing);
  }
  return flows;
}

/**
 * Codes per request. The preview endpoint caps a response at 500 rows and, with
 * aggregate pinning, each code yields at most two (one import, one export). 90
 * codes therefore lands around 180 rows — comfortably inside the cap with room
 * for reporters that split a code across several rows anyway.
 *
 * This is what makes a whole-country scan affordable: the 16-sector taxonomy
 * references 68 distinct codes in total, so scanning every sector at once costs
 * the same two requests as scanning one.
 */
const MAX_CODES_PER_REQUEST = 90;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type YearResult =
  | { status: "ok"; rows: TradeRow[]; truncated: boolean }
  | { status: "empty" }
  | { status: "rate-limited" };

/**
 * Fetch every chunk for a single reporting year.
 *
 * A year counts as empty only when no chunk returned rows; one silent chunk
 * among several is a coverage gap in that slice of the tariff schedule, not
 * evidence that the country failed to report.
 */
async function queryYearChunked(
  reporterCode: number,
  chunks: string[][],
  year: number,
  signal: AbortSignal,
): Promise<YearResult> {
  const rows: TradeRow[] = [];
  let truncated = false;
  let sawData = false;
  let rateLimited = false;

  for (const codes of chunks) {
    const result = await queryYearWithRetry(reporterCode, codes, year, signal);
    if (result.status === "ok") {
      sawData = true;
      rows.push(...result.rows);
      if (result.rows.length >= 500) truncated = true;
    } else if (result.status === "rate-limited") {
      rateLimited = true;
      break;
    }
  }

  if (sawData) return { status: "ok", rows, truncated };
  return rateLimited ? { status: "rate-limited" } : { status: "empty" };
}

export interface TradeData {
  /** Latest reporting year with data. */
  current: Map<string, TradeFlow>;
  /** Roughly three years earlier, for trajectory. Null if unavailable. */
  baseline: Map<string, TradeFlow> | null;
  currentYear: number | null;
  baselineYear: number | null;
}

export const EMPTY_TRADE_DATA: TradeData = {
  current: new Map(),
  baseline: null,
  currentYear: null,
  baselineYear: null,
};

/**
 * How many years back to look for the trajectory baseline. Three years is far
 * enough that a single volatile year does not dominate, close enough that the
 * comparison still describes the current market.
 */
const TREND_LOOKBACK = 3;

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
  tracer: Tracer = NULL_TRACER,
): Promise<TradeData> {
  const flows = new Map<string, TradeFlow>();
  const reporterCode = REPORTER_CODES[iso3];

  tracer.node({
    id: "src:comtrade",
    kind: "source",
    label: "UN Comtrade",
    parent: `country:${iso3}`,
    detail: `${hsCodes.length} HS codes, imports and exports against the world`,
    status: "active",
  });

  if (!reporterCode) {
    bundle.warnings.push(
      `${iso3} is not a Comtrade reporter — trade-gap analysis unavailable, scores fall back to demand modelling.`,
    );
    tracer.status("src:comtrade", "empty", {
      detail: `${iso3} does not report to Comtrade`,
    });
    return EMPTY_TRADE_DATA;
  }
  if (hsCodes.length === 0) {
    tracer.status("src:comtrade", "empty", { detail: "No HS codes requested" });
    return EMPTY_TRADE_DATA;
  }

  const chunks = chunk(hsCodes, MAX_CODES_PER_REQUEST);
  const controller = new AbortController();
  // Chunked requests are serialised behind the rate limiter, so the ceiling
  // has to scale with how many of them there are.
  const timeout = setTimeout(
    () => controller.abort(),
    20000 + chunks.length * 12000,
  );

  try {
    let rows: TradeRow[] | null = null;
    let usedYear = 0;
    let throttledOut = false;
    let truncated = false;

    // Try the year we already know reports data for this country first.
    const known = resolvedYear.get(iso3);
    const years = known
      ? [known, ...candidateYears(currentYear).filter((y) => y !== known)]
      : candidateYears(currentYear);

    for (const year of years) {
      tracer.note(`Probing Comtrade for ${iso3} ${year}…`);
      const result = await queryYearChunked(
        reporterCode,
        chunks,
        year,
        controller.signal,
      );

      if (result.status === "ok") {
        rows = result.rows;
        truncated = result.truncated;
        usedYear = year;
        resolvedYear.set(iso3, year);
        break;
      }
      if (result.status === "rate-limited") {
        throttledOut = true;
        break;
      }
      // "empty" means: try an earlier year.
    }

    if (!rows) {
      bundle.warnings.push(
        throttledOut
          ? "UN Comtrade rate limit reached, so trade gaps in this sector are modelled rather than observed. Retry shortly, or set COMTRADE_API_KEY for higher limits."
          : `Comtrade returned no trade records for ${iso3} in the last four reporting years.`,
      );
      tracer.status("src:comtrade", throttledOut ? "error" : "empty", {
        detail: throttledOut
          ? "Rate limited"
          : "No records in the last four reporting years",
      });
      return EMPTY_TRADE_DATA;
    }

    // The preview endpoint caps at 500 rows. With aggregate pinning we expect
    // at most 2 rows per HS code, so hitting the cap means the response was
    // truncated and any total computed from it would be understated.
    if (truncated) {
      bundle.warnings.push(
        "UN Comtrade returned a truncated result set; trade totals may be understated. Set COMTRADE_API_KEY to lift the preview row cap.",
      );
    }

    const currentFlows = rowsToFlows(rows, usedYear);
    for (const [code, flow] of currentFlows) flows.set(code, flow);

    tracer.status("src:comtrade", "ok", {
      detail: `${flows.size} of ${hsCodes.length} HS codes reported in ${usedYear} (${chunks.length} request${chunks.length === 1 ? "" : "s"})`,
    });

    // Trajectory baseline. A failure here is not fatal — the gap is still
    // reported, just without a direction of travel.
    let baseline: Map<string, TradeFlow> | null = null;
    let baselineYear: number | null = null;
    const baseTarget = usedYear - TREND_LOOKBACK;
    tracer.node({
      id: "src:comtrade-baseline",
      kind: "source",
      label: `Baseline ${baseTarget}`,
      parent: "src:comtrade",
      detail: "Same codes three years earlier, for direction of travel",
      status: "active",
    });
    const baseResult = await queryYearChunked(
      reporterCode,
      chunks,
      baseTarget,
      controller.signal,
    );
    if (baseResult.status === "ok") {
      baseline = rowsToFlows(baseResult.rows, baseTarget);
      baselineYear = baseTarget;
      tracer.status("src:comtrade-baseline", "ok", {
        detail: `${baseline.size} codes reported in ${baseTarget}`,
      });
    } else {
      tracer.status("src:comtrade-baseline", "empty", {
        detail: "No comparable earlier year — trajectory unavailable",
      });
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

    return {
      current: flows,
      baseline,
      currentYear: usedYear,
      baselineYear,
    };
  } catch (err) {
    bundle.warnings.push(
      `Comtrade request failed (${err instanceof Error ? err.message : "unknown error"}); trade gaps for this sector are modelled, not observed.`,
    );
    tracer.status("src:comtrade", "error", {
      detail: err instanceof Error ? err.message : "Request failed",
    });
    return EMPTY_TRADE_DATA;
  } finally {
    clearTimeout(timeout);
  }
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
  /**
   * Annualised change in net imports, percent. A widening gap means demand is
   * outrunning domestic supply — the opportunity is opening, not closing. Null
   * when no comparable earlier year could be fetched.
   */
  trendPct: number | null;
  /** The earlier year the trend was measured against. */
  trendBaseYear: string | null;
}

/** One 6-digit product line within a segment. */
export interface ProductGap {
  hsCode: string;
  description: string;
  imports: number;
  exports: number;
  netImports: number;
  importDependency: number;
}

/**
 * Comtrade accepts long cmdCode lists (129 verified), but not unbounded ones.
 * Batching is capped so a single drill-down cannot spend a minute in the
 * rate-limit queue: 2 batches x 120 codes covers every segment we define
 * except the very largest chapters, which are truncated with a warning.
 */
const PRODUCT_BATCH_SIZE = 120;
const MAX_PRODUCT_BATCHES = 2;

/**
 * Resolve a segment's HS prefixes down to individual 6-digit product lines and
 * report which of them carry the import gap. This is what turns "Dairy,
 * $269M" into "milk and cream, concentrated — $47M", which is the level a
 * business decision is actually made at.
 */
export async function fetchProductGaps(
  iso3: string,
  codes6: string[],
  descriptions: Record<string, string>,
  year: number,
  bundle: SignalBundle,
): Promise<ProductGap[]> {
  const reporterCode = REPORTER_CODES[iso3];
  if (!reporterCode || codes6.length === 0) return [];

  const batches: string[][] = [];
  for (let i = 0; i < codes6.length; i += PRODUCT_BATCH_SIZE) {
    batches.push(codes6.slice(i, i + PRODUCT_BATCH_SIZE));
  }
  if (batches.length > MAX_PRODUCT_BATCHES) {
    const dropped = batches
      .slice(MAX_PRODUCT_BATCHES)
      .reduce((n, b) => n + b.length, 0);
    bundle.warnings.push(
      `This segment spans ${codes6.length} product lines; the ${dropped} smallest-chapter lines were not queried to keep the request within rate limits.`,
    );
    batches.length = MAX_PRODUCT_BATCHES;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const totals = new Map<string, { m: number; x: number }>();

  try {
    for (const batch of batches) {
      const result = await queryYearWithRetry(
        reporterCode,
        batch,
        year,
        controller.signal,
      );
      if (result.status !== "ok") continue;
      if (result.rows.length >= 500) {
        bundle.warnings.push(
          "Product drill-down hit the 500-row preview cap; some lines are missing. Set COMTRADE_API_KEY to lift it.",
        );
      }
      for (const row of result.rows) {
        const entry = totals.get(row.cmdCode) ?? { m: 0, x: 0 };
        if (row.flowCode === "M") entry.m += row.primaryValue ?? 0;
        if (row.flowCode === "X") entry.x += row.primaryValue ?? 0;
        totals.set(row.cmdCode, entry);
      }
    }
  } catch (err) {
    bundle.warnings.push(
      `Product drill-down failed (${err instanceof Error ? err.message : "unknown error"}).`,
    );
  } finally {
    clearTimeout(timeout);
  }

  return Array.from(totals.entries())
    .map(([hsCode, v]) => ({
      hsCode,
      description: descriptions[hsCode] ?? `HS ${hsCode}`,
      imports: v.m,
      exports: v.x,
      netImports: v.m - v.x,
      importDependency: v.m + v.x > 0 ? v.m / (v.m + v.x) : 0,
    }))
    .filter((p) => p.netImports > 0)
    .sort((a, b) => b.netImports - a.netImports);
}

function totalsFor(
  flows: Map<string, TradeFlow>,
  hsCodes: string[],
): { imports: number; exports: number; year: string; observed: boolean } {
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
  return { imports, exports, year, observed };
}

export function summariseGap(data: TradeData, hsCodes: string[]): TradeGap {
  const now = totalsFor(data.current, hsCodes);
  const total = now.imports + now.exports;
  const netImports = now.imports - now.exports;

  let trendPct: number | null = null;
  let trendBaseYear: string | null = null;

  if (data.baseline && data.baselineYear && data.currentYear) {
    const before = totalsFor(data.baseline, hsCodes);
    const beforeNet = before.imports - before.exports;
    const years = data.currentYear - data.baselineYear;
    // A CAGR is only meaningful when both endpoints are positive net imports.
    // A gap that flipped sign (net importer to net exporter, or back) is a
    // structural change that a growth rate would misrepresent.
    if (before.observed && beforeNet > 0 && netImports > 0 && years > 0) {
      trendPct = (Math.pow(netImports / beforeNet, 1 / years) - 1) * 100;
      trendBaseYear = String(data.baselineYear);
    }
  }

  return {
    imports: now.imports,
    exports: now.exports,
    netImports,
    importDependency: total > 0 ? now.imports / total : 0,
    year: now.year,
    observed: now.observed,
    trendPct,
    trendBaseYear,
  };
}
