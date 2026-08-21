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

import { NULL_TRACER, type Tracer } from "../engine/trace";
import { put, type SignalBundle } from "./types";

/**
 * Overpass mirrors, tried in order.
 *
 * These are volunteer-run instances and any one of them can be down, overloaded
 * or refusing a busy client at any moment — during development the main
 * instance stopped answering entirely for a stretch. Falling through to a
 * mirror turns a total loss of the competition signal into a slower one.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/**
 * The denominator: a stable, broadly-mapped slice of commercial activity used
 * to normalise for how completely a country is mapped at all.
 *
 * It is a completeness yardstick, not a strict superset of the numerators.
 * Several segments are counted from tags outside it — hotels are `tourism`,
 * estate agents and lawyers are `office`, trades are `craft` — so a segment's
 * "share" is a ratio against that yardstick rather than a literal share of it.
 * That is what the measure needs to be: both numerator and denominator scale
 * with local mapping effort, so the effort cancels and two countries become
 * comparable. Deliberately excludes non-commercial amenities (benches, waste
 * baskets, parking) which would swamp the count and swing with mapping fashion.
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
    // Footwear moved to tex-leather so the two segments are not both scored
    // off the same premises.
    selector: `["shop"~"^(clothes|boutique|fashion_accessories)$"]`,
    referenceShare: 0.045,
    label: "clothing retail",
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

  // ---- Second tranche -----------------------------------------------------
  // Segments whose businesses are also genuinely visible as mapped premises.
  // The bar is the same: a tag that mappers actually use for this activity,
  // not a tag that could loosely be argued to cover it. Segments still absent
  // (software, most manufacturing, wholesale-by-office) have no reliable OSM
  // footprint and get no signal rather than a fabricated one.
  {
    segmentId: "fnb-beverage",
    selector: `["shop"~"^(beverages|alcohol|wine)$"]`,
    referenceShare: 0.018,
    label: "drinks retailers",
  },
  {
    segmentId: "agri-inputs",
    selector: `["shop"~"^(agrarian|garden_centre|farm)$"]`,
    referenceShare: 0.006,
    label: "agricultural supply and garden stores",
  },
  {
    segmentId: "mfg-buildingmaterials",
    selector: `["shop"~"^(doityourself|hardware|paint|building_materials)$"]`,
    referenceShare: 0.02,
    label: "building material and hardware suppliers",
  },
  {
    segmentId: "retail-b2b-distribution",
    selector: `["shop"~"^(wholesale|trade)$"]`,
    referenceShare: 0.008,
    label: "wholesalers and trade counters",
  },
  {
    segmentId: "retail-resale",
    selector: `["shop"~"^(second_hand|charity|antiques)$"]`,
    referenceShare: 0.008,
    label: "second-hand and resale shops",
  },
  {
    segmentId: "health-medtech-distribution",
    selector: `["shop"~"^(medical_supply|optician|hearing_aids)$"]`,
    referenceShare: 0.012,
    label: "medical supply, optician and hearing outlets",
  },
  {
    segmentId: "health-eldercare",
    selector: `["amenity"="social_facility"]["social_facility"~"^(nursing_home|assisted_living|group_home)$"]`,
    referenceShare: 0.004,
    label: "care homes and assisted living facilities",
  },
  {
    segmentId: "tex-leather",
    selector: `["shop"~"^(shoes|bag|leather)$"]`,
    referenceShare: 0.02,
    label: "footwear and leather goods retail",
  },
  {
    segmentId: "tour-experiences",
    selector: `["shop"="travel_agency"]`,
    referenceShare: 0.008,
    label: "travel agencies and tour operators",
  },
  {
    segmentId: "waste-recycling",
    selector: `["amenity"="recycling"]["recycling_type"="centre"]`,
    referenceShare: 0.006,
    label: "recycling centres",
  },
  {
    segmentId: "waste-collection",
    selector: `["amenity"~"^(waste_disposal|waste_transfer_station)$"]`,
    referenceShare: 0.005,
    label: "waste transfer and disposal sites",
  },
  {
    segmentId: "mob-ev",
    selector: `["amenity"="charging_station"]`,
    referenceShare: 0.01,
    label: "EV charging points",
  },
  {
    segmentId: "mob-shared",
    selector: `["amenity"~"^(bicycle_rental|car_sharing|motorcycle_rental)$"]`,
    referenceShare: 0.005,
    label: "shared bike, scooter and car points",
  },
  {
    segmentId: "fin-insurance",
    selector: `["office"="insurance"]`,
    referenceShare: 0.01,
    label: "insurance offices",
  },
  {
    segmentId: "svc-legal-advisory",
    selector: `["office"="lawyer"]`,
    referenceShare: 0.014,
    label: "law practices",
  },
  {
    segmentId: "svc-accounting-compliance",
    selector: `["office"~"^(accountant|tax_advisor)$"]`,
    referenceShare: 0.01,
    label: "accountancy and tax practices",
  },
  {
    segmentId: "svc-marketing",
    selector: `["office"~"^(advertising_agency|graphic_design)$"]`,
    referenceShare: 0.005,
    label: "advertising and design agencies",
  },
  {
    segmentId: "tech-outsourcing",
    selector: `["office"~"^(it|telecommunication)$"]`,
    referenceShare: 0.008,
    label: "IT and telecoms service offices",
  },
  {
    segmentId: "re-contracting",
    selector: `["craft"~"^(plumber|electrician|carpenter|builder|painter|hvac|roofer)$"]`,
    referenceShare: 0.012,
    label: "building trades",
  },
  {
    segmentId: "edu-vocational",
    selector: `["amenity"="college"]`,
    referenceShare: 0.005,
    label: "colleges and vocational institutes",
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

/**
 * Rules per Overpass request.
 *
 * Overpass evaluates the statements in a query sequentially, so one request
 * carrying all 32 rules takes as long as all 32 counts added together — 74s for
 * Lebanon, past the 60s ceiling a serverless function gets. Splitting into
 * parallel requests turns that sum into a maximum. The denominator is repeated
 * in each chunk, which costs two extra counts per request and buys the ability
 * to use whichever chunk returns.
 */
const RULES_PER_REQUEST = 8;

/**
 * Overpass runs roughly two slots per client, so firing every chunk at once
 * does not go faster — it collects 429s and then pays for the retries. Two at
 * a time matches what the endpoint will actually serve.
 */
const MAX_CONCURRENT_REQUESTS = 2;

/** Run tasks with a fixed concurrency ceiling, preserving input order. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunkRules(rules: DensityRule[]): DensityRule[][] {
  const out: DensityRule[][] = [];
  for (let i = 0; i < rules.length; i += RULES_PER_REQUEST) {
    out.push(rules.slice(i, i + RULES_PER_REQUEST));
  }
  return out;
}

function buildQuery(iso2: string, rules: DensityRule[]): string {
  const head = `[out:json][timeout:180];area["ISO3166-1"="${iso2}"][admin_level=2]->.a;`;
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

  // One attempt per mirror, then one more pass with backoff. A mirror that is
  // merely busy usually answers on the second pass; one that is down never
  // will, and the loop moves on rather than spending the whole budget on it.
  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length * 2; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    if (attempt >= OVERPASS_ENDPOINTS.length) await sleep(2000);
    try {
      const res = await fetch(endpoint, {
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
  tracer: Tracer = NULL_TRACER,
  countryNodeId?: string,
): Promise<DensityResult> {
  const rules = DENSITY_RULES.filter((r) => segmentIds.includes(r.segmentId));
  if (rules.length === 0) return EMPTY_DENSITY;

  tracer.node({
    id: "src:osm",
    kind: "source",
    label: "OpenStreetMap",
    parent: countryNodeId,
    detail: `Counting mapped premises for ${rules.length} measurable segment${rules.length === 1 ? "" : "s"}`,
    status: "active",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const chunks = chunkRules(rules);
    const responses = await mapWithLimit(
      chunks,
      MAX_CONCURRENT_REQUESTS,
      async (chunk) => {
        const res = await postWithRetry(
          buildQuery(iso2, chunk),
          controller.signal,
        );
        if (!res || !res.ok) return { chunk, counts: null, status: res?.status };
        const body = (await res.json()) as { elements?: OverpassCount[] };
        const counts = (body.elements ?? []).filter((e) => e.type === "count");
        // chunk.length segment counts, then 2 denominator counts.
        if (counts.length < chunk.length + 2) {
          return { chunk, counts: null, status: res.status };
        }
        return { chunk, counts, status: res.status };
      },
    );

    const usable = responses.filter((r) => r.counts !== null);
    if (usable.length === 0) {
      const status = responses.find((r) => r.status)?.status;
      bundle.warnings.push(
        status
          ? `OpenStreetMap density lookup returned ${status}; competition estimates fall back to structural proxies.`
          : "OpenStreetMap was unreachable; competition estimates fall back to structural proxies.",
      );
      tracer.status("src:osm", "error", {
        detail: status ? `Overpass returned ${status}` : "Overpass unreachable",
      });
      return EMPTY_DENSITY;
    }

    // Every chunk measures the same country, so the denominators agree; take
    // the first that came back rather than re-querying.
    const first = usable[0];
    const universe =
      readCount(first.counts![first.chunk.length]) +
      readCount(first.counts![first.chunk.length + 1]);

    if (universe < 500) {
      // Too thinly mapped for composition to mean anything.
      bundle.warnings.push(
        `Only ${universe.toLocaleString()} commercial premises are mapped in OpenStreetMap for this country — too few to judge market saturation, so that signal is omitted.`,
      );
      tracer.status("src:osm", "empty", {
        detail: `Only ${universe.toLocaleString()} premises mapped — too thin to judge saturation`,
      });
      return EMPTY_DENSITY;
    }

    const bySegment = new Map<string, SegmentDensity>();
    for (const { chunk, counts } of usable) {
      chunk.forEach((rule, i) => {
        const count = readCount(counts![i]);
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
    }

    if (usable.length < chunks.length) {
      bundle.warnings.push(
        `${chunks.length - usable.length} of ${chunks.length} OpenStreetMap batches did not return, so some segments have no observed competition signal.`,
      );
    }

    put(bundle, {
      key: "osm.universe",
      value: universe,
      unit: "premises",
      provenance: "live",
      source: "OpenStreetMap via Overpass",
      confidence: 0.7,
    });

    tracer.status("src:osm", "ok", {
      detail: `${universe.toLocaleString()} commercial premises mapped; ${bySegment.size} segments measured against it`,
    });

    return { bySegment, universe, available: true };
  } catch (err) {
    bundle.warnings.push(
      `OpenStreetMap density lookup failed (${err instanceof Error ? err.message : "unknown error"}); competition estimates fall back to structural proxies.`,
    );
    tracer.status("src:osm", "error", {
      detail: err instanceof Error ? err.message : "Request failed",
    });
    return EMPTY_DENSITY;
  } finally {
    clearTimeout(timeout);
  }
}

export function hasDensityRule(segmentId: string): boolean {
  return DENSITY_RULES.some((r) => r.segmentId === segmentId);
}
