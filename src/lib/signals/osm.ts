/**
 * OpenStreetMap / Overpass connector — the supply side.
 *
 * Trade data shows what a country buys from abroad. It says nothing about how
 * many businesses already operate on the ground, which is the difference
 * between an unserved market and a crowded one. Counting mapped premises is
 * the closest free proxy for that.
 *
 * The obvious trap: raw counts confound "few businesses exist" with "this
 * country is poorly mapped". Lebanon and Germany are not mapped to remotely
 * the same depth, so comparing restaurants-per-million between them measures
 * OSM contributor activity as much as it measures the restaurant trade.
 *
 * So we never use raw counts. We measure each segment's share of the country's
 * own mapped commercial universe and compare that composition against a
 * reference share. Mapping completeness cancels out of a ratio taken within
 * one country.
 */

import { put, type SignalBundle } from "./types";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/**
 * The commercial universe used as the denominator. Deliberately excludes
 * non-commercial amenities (benches, waste baskets, parking) which would swamp
 * the count and vary wildly with local mapping fashion.
 */
const DENOMINATOR_AMENITIES =
  "restaurant|fast_food|cafe|bar|pub|pharmacy|clinic|doctors|dentist|bank|fuel|car_wash|school|kindergarten|marketplace|veterinary";

interface DensityRule {
  segmentId: string;
  /** Overpass selector body, e.g. `["amenity"~"^(restaurant)$"]`. */
  selector: string;
  /**
   * Expected share of a market's mapped commercial POIs, as a decimal.
   * Curated, approximate, and deliberately low-weighted in scoring.
   */
  referenceShare: number;
  label: string;
}

/**
 * Only segments whose businesses are genuinely visible as mapped premises are
 * listed. Manufacturing, wholesale and software have no reliable OSM
 * footprint, so they get no density signal rather than a fabricated one.
 */
const DENSITY_RULES: DensityRule[] = [
  {
    segmentId: "fnb-restaurants",
    selector: `["amenity"~"^(restaurant|fast_food|cafe)$"]`,
    referenceShare: 0.17,
    label: "restaurants, cafés and fast food",
  },
  {
    segmentId: "fnb-bakery",
    selector: `["shop"="bakery"]`,
    referenceShare: 0.022,
    label: "bakeries",
  },
  {
    segmentId: "retail-grocery",
    selector: `["shop"~"^(supermarket|convenience|greengrocer)$"]`,
    referenceShare: 0.075,
    label: "grocery and convenience stores",
  },
  {
    segmentId: "health-pharmacy",
    selector: `["amenity"="pharmacy"]`,
    referenceShare: 0.035,
    label: "pharmacies",
  },
  {
    segmentId: "health-clinics",
    selector: `["amenity"~"^(clinic|doctors)$"]`,
    referenceShare: 0.028,
    label: "clinics and doctors' practices",
  },
  {
    segmentId: "tour-boutique-lodging",
    selector: `["tourism"~"^(hotel|guest_house|hostel|apartment)$"]`,
    referenceShare: 0.03,
    label: "hotels and guest houses",
  },
  {
    segmentId: "mob-parts-service",
    selector: `["shop"~"^(car_repair|car_parts|tyres)$"]`,
    referenceShare: 0.032,
    label: "vehicle repair and parts outlets",
  },
  {
    segmentId: "edu-k12-private",
    selector: `["amenity"="school"]`,
    referenceShare: 0.035,
    label: "schools",
  },
  {
    segmentId: "fin-payments",
    selector: `["amenity"~"^(bank|bureau_de_change)$"]`,
    referenceShare: 0.028,
    label: "bank branches and exchange bureaux",
  },
  {
    segmentId: "tex-brands",
    selector: `["shop"~"^(clothes|boutique|shoes)$"]`,
    referenceShare: 0.055,
    label: "clothing and footwear retail",
  },
  {
    segmentId: "re-rental-management",
    selector: `["office"="estate_agent"]`,
    referenceShare: 0.012,
    label: "estate agents",
  },
  {
    segmentId: "energy-solar",
    selector: `["shop"~"^(energy|solar)$"]`,
    referenceShare: 0.004,
    label: "energy and solar suppliers",
  },
];

export interface SegmentDensity {
  segmentId: string;
  label: string;
  count: number;
  perMillion: number;
  /** Segment share of this country's mapped commercial POIs. */
  share: number;
  referenceShare: number;
  /** >1 means denser than a typical market; <1 means thinner. */
  saturation: number;
}

export interface DensityResult {
  bySegment: Map<string, SegmentDensity>;
  /** Total mapped commercial POIs — the completeness denominator. */
  universe: number;
  available: boolean;
}

export const EMPTY_DENSITY: DensityResult = {
  bySegment: new Map(),
  universe: 0,
  available: false,
};

function buildQuery(iso2: string, rules: DensityRule[]): string {
  const head = `[out:json][timeout:60];area["ISO3166-1"="${iso2}"][admin_level=2]->.a;`;
  const counts = rules
    .map((r) => `nwr${r.selector}(area.a);out count;`)
    .join("");
  // Denominator, emitted last so its position is predictable.
  const denominator =
    `nwr["shop"](area.a);out count;` +
    `nwr["amenity"~"^(${DENOMINATOR_AMENITIES})$"](area.a);out count;`;
  return head + counts + denominator;
}

/**
 * Overpass is a free community endpoint with two hard requirements that both
 * present as opaque HTTP errors:
 *  - Requests must identify themselves. An anonymous POST is answered 406,
 *    which reads like a malformed query rather than a missing header.
 *  - The public instance sheds load with 502/503/504 under contention, which
 *    is transient and worth one retry rather than a discarded signal.
 */
const USER_AGENT = "Ideaz-MarketGapEngine/1.0 (market gap research tool)";
const RETRYABLE = new Set([429, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postWithRetry(
  query: string,
  signal: AbortSignal,
): Promise<Response | null> {
  let last: Response | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2500 * attempt);
    try {
      const res = await fetch(OVERPASS_ENDPOINT, {
        method: "POST",
        // Overpass expects the query as a form field named `data`; posting it
        // as a bare text/plain body is answered with 406.
        body: new URLSearchParams({ data: query }).toString(),
        signal,
        // Premise counts move slowly; a month of cache is appropriate and
        // keeps load off a free community endpoint.
        next: { revalidate: 2592000 },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": USER_AGENT,
          accept: "application/json",
        },
      });
      if (res.ok || !RETRYABLE.has(res.status)) return res;
      last = res;
    } catch {
      last = null;
    }
  }
  return last;
}

interface OverpassCount {
  type: string;
  tags?: Record<string, string>;
}

function readCount(element: OverpassCount | undefined): number {
  if (!element?.tags) return 0;
  const t = element.tags;
  if (t.total !== undefined) return Number(t.total) || 0;
  return (
    (Number(t.nodes) || 0) + (Number(t.ways) || 0) + (Number(t.relations) || 0)
  );
}

/**
 * Fetch premise counts for whichever of a sector's segments are measurable.
 * Returns an empty result rather than throwing: density is an enrichment, and
 * losing it must never take the whole analysis down with it.
 */
export async function fetchDensity(
  iso2: string,
  segmentIds: string[],
  population: number,
  bundle: SignalBundle,
): Promise<DensityResult> {
  const rules = DENSITY_RULES.filter((r) => segmentIds.includes(r.segmentId));
  if (rules.length === 0) return EMPTY_DENSITY;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await postWithRetry(
      buildQuery(iso2, rules),
      controller.signal,
    );

    if (!res || !res.ok) {
      bundle.warnings.push(
        res
          ? `OpenStreetMap density lookup returned ${res.status}; competition estimates fall back to structural proxies.`
          : "OpenStreetMap was unreachable; competition estimates fall back to structural proxies.",
      );
      return EMPTY_DENSITY;
    }

    const body = (await res.json()) as { elements?: OverpassCount[] };
    const counts = (body.elements ?? []).filter((e) => e.type === "count");

    // rules.length segment counts, then 2 denominator counts.
    if (counts.length < rules.length + 2) {
      bundle.warnings.push(
        "OpenStreetMap returned an incomplete response; competition estimates fall back to structural proxies.",
      );
      return EMPTY_DENSITY;
    }

    const universe =
      readCount(counts[rules.length]) + readCount(counts[rules.length + 1]);

    if (universe < 500) {
      // Too thinly mapped for composition to mean anything.
      bundle.warnings.push(
        `Only ${universe.toLocaleString()} commercial premises are mapped in OpenStreetMap for this country — too few to judge market saturation, so that signal is omitted.`,
      );
      return EMPTY_DENSITY;
    }

    const bySegment = new Map<string, SegmentDensity>();
    rules.forEach((rule, i) => {
      const count = readCount(counts[i]);
      const share = count / universe;
      const perMillion = population > 0 ? count / (population / 1e6) : 0;
      bySegment.set(rule.segmentId, {
        segmentId: rule.segmentId,
        label: rule.label,
        count,
        perMillion,
        share,
        referenceShare: rule.referenceShare,
        saturation: rule.referenceShare > 0 ? share / rule.referenceShare : 1,
      });
    });

    put(bundle, {
      key: "osm.universe",
      value: universe,
      unit: "premises",
      provenance: "live",
      source: "OpenStreetMap via Overpass",
      confidence: 0.7,
    });

    return { bySegment, universe, available: true };
  } catch (err) {
    bundle.warnings.push(
      `OpenStreetMap density lookup failed (${err instanceof Error ? err.message : "unknown error"}); competition estimates fall back to structural proxies.`,
    );
    return EMPTY_DENSITY;
  } finally {
    clearTimeout(timeout);
  }
}

export function hasDensityRule(segmentId: string): boolean {
  return DENSITY_RULES.some((r) => r.segmentId === segmentId);
}
