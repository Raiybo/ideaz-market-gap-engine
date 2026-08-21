/**
 * Match an uploaded document to the taxonomy.
 *
 * The document says what someone wants to build; the engine only knows how to
 * reason about segments, countries and entry routes. This is the translation
 * layer, and it is deliberately transparent about its own confidence: a weak
 * match produces a weak verdict, and saying so is more useful than quietly
 * assessing the wrong segment.
 *
 * Matching is lexical rather than semantic. That is a real limitation and it is
 * stated in the output, but it has one large compensating advantage here: the
 * HS index gives every goods segment a few hundred lines of customs vocabulary
 * ("cheese", "yoghurt", "whey", "butter"), which is exactly the language a
 * document about that business uses.
 */

import { COUNTRIES, type Country } from "../domain/countries";
import { expandToProductCodes, HS_DESCRIPTIONS } from "../domain/hs";
import { ALL_SEGMENTS, type Sector, type Segment } from "../domain/sectors";
import type { EntryRouteId } from "../engine/playbook";

const STOPWORDS = new Set([
  "the","and","for","are","but","not","you","all","any","can","had","her","was",
  "one","our","out","day","get","has","him","his","how","its","new","now","old",
  "see","two","who","boy","did","use","way","with","this","that","from","they",
  "have","will","your","what","when","make","them","than","then","some","such",
  "into","only","other","more","most","also","been","were","their","there",
  "which","would","about","after","first","over","these","using","used","based",
  "including","include","includes","between","through","within","across","under",
  "while","where","being","because","during","before","against","among","those",
  "each","both","very","much","many","every","per","via","etc","inc","ltd",
  "company","business","market","markets","product","products","service",
  "services","customer","customers","solution","solutions","platform","team",
  "revenue","cost","costs","price","pricing","year","years","month","months",
  "million","billion","usd","growth","plan","model","value","high","low","new",
  "page","slide","figure","table","source","data",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t))
    .filter((t) => t.length >= 3 && t.length <= 24 && !STOPWORDS.has(t));
}

/** How many customs lines contribute vocabulary to a goods segment. */
const HS_VOCAB_LINES = 60;

interface SegmentProfile {
  segment: Segment;
  sector: Sector;
  /** token -> weight within this segment's own vocabulary */
  terms: Map<string, number>;
}

/**
 * Built once per process. The taxonomy is static, so this is a cache, not a
 * request cost.
 */
let profileCache: { profiles: SegmentProfile[]; idf: Map<string, number> } | null =
  null;

function buildProfiles() {
  if (profileCache) return profileCache;

  const profiles: SegmentProfile[] = ALL_SEGMENTS.map(({ sector, segment }) => {
    const terms = new Map<string, number>();

    const add = (text: string, weight: number) => {
      for (const token of tokenize(text)) {
        terms.set(token, (terms.get(token) ?? 0) + weight);
      }
    };

    // The segment's own name is the strongest signal it has.
    add(segment.name, 6);
    add(segment.description, 3);
    add(sector.name, 1.5);
    add(sector.blurb, 0.4);

    if (segment.hsCodes.length > 0) {
      const codes = expandToProductCodes(segment.hsCodes).slice(0, HS_VOCAB_LINES);
      for (const code of codes) {
        const description = HS_DESCRIPTIONS[code];
        if (description) add(description, 0.7);
      }
    }

    return { segment, sector, terms };
  });

  // Inverse document frequency across segments: "dairy" discriminates,
  // "manufacturing" does not.
  const documentCount = profiles.length;
  const appearances = new Map<string, number>();
  for (const profile of profiles) {
    for (const term of profile.terms.keys()) {
      appearances.set(term, (appearances.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [term, count] of appearances) {
    idf.set(term, Math.log(documentCount / count) + 0.35);
  }

  profileCache = { profiles, idf };
  return profileCache;
}

export interface SegmentMatch {
  segmentId: string;
  sectorId: string;
  name: string;
  sectorName: string;
  score: number;
  /** 0..1 relative to the best possible showing for this document. */
  confidence: number;
  /** The document terms that drove the match, strongest first. */
  evidence: string[];
}

export interface CountryMatch {
  iso3: string;
  name: string;
  mentions: number;
}

/**
 * Aliases and demonyms that a document is far more likely to use than the
 * registry's formal name. Not exhaustive by design — the country is also
 * selectable in the UI, and this only has to be right often enough to be
 * worth offering as a correction.
 */
const COUNTRY_ALIASES: Record<string, string[]> = {
  ARE: ["uae", "u.a.e", "emirates", "dubai", "abu dhabi", "sharjah", "emirati"],
  SAU: ["ksa", "saudi", "riyadh", "jeddah"],
  USA: ["us", "u.s", "usa", "america", "american", "united states"],
  GBR: ["uk", "u.k", "britain", "british", "england", "london"],
  LBN: ["lebanese", "beirut", "tripoli"],
  EGY: ["egyptian", "cairo", "alexandria"],
  TUR: ["turkey", "turkish", "istanbul", "ankara"],
  IND: ["indian", "mumbai", "delhi", "bangalore", "bengaluru"],
  CHN: ["chinese", "shanghai", "shenzhen", "beijing"],
  NGA: ["nigerian", "lagos", "abuja"],
  KEN: ["kenyan", "nairobi"],
  ZAF: ["south african", "johannesburg", "cape town"],
  DEU: ["german", "berlin", "munich"],
  FRA: ["french", "paris"],
  ESP: ["spanish", "madrid", "barcelona"],
  ITA: ["italian", "milan", "rome"],
  NLD: ["dutch", "amsterdam", "netherlands"],
  BRA: ["brazilian", "sao paulo", "são paulo"],
  MEX: ["mexican", "mexico city", "monterrey"],
  ARG: ["argentine", "argentinian", "buenos aires"],
  JPN: ["japanese", "tokyo"],
  KOR: ["korea", "korean", "seoul"],
  SGP: ["singaporean"],
  IDN: ["indonesian", "jakarta"],
  VNM: ["vietnamese", "hanoi", "ho chi minh"],
  PHL: ["filipino", "philippine", "manila"],
  PAK: ["pakistani", "karachi", "lahore"],
  BGD: ["bangladeshi", "dhaka"],
  MAR: ["moroccan", "casablanca", "rabat"],
  JOR: ["jordanian", "amman"],
  IRQ: ["iraqi", "baghdad", "erbil"],
  QAT: ["qatari", "doha"],
  KWT: ["kuwaiti"],
  GHA: ["ghanaian", "accra"],
  ETH: ["ethiopian", "addis ababa"],
  POL: ["polish", "warsaw"],
  UKR: ["ukrainian", "kyiv", "kiev"],
  KAZ: ["kazakh", "almaty", "astana"],
  GRC: ["greek", "athens"],
  PRT: ["portuguese", "lisbon"],
  CHE: ["swiss", "zurich", "geneva"],
  AUS: ["australian", "sydney", "melbourne"],
  CAN: ["canadian", "toronto", "vancouver"],
};

export function detectCountry(text: string): CountryMatch[] {
  const haystack = ` ${text.toLowerCase()} `;
  const results: CountryMatch[] = [];

  const countMatches = (needle: string): number => {
    if (needle.length < 2) return 0;
    // Word-bounded so "us" does not match "industry" and "in" does not match
    // everything.
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = haystack.match(new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "g"));
    return matches ? matches.length : 0;
  };

  for (const country of COUNTRIES) {
    let mentions = countMatches(country.name.toLowerCase());
    for (const alias of COUNTRY_ALIASES[country.iso3] ?? []) {
      mentions += countMatches(alias);
    }
    if (mentions > 0) {
      results.push({ iso3: country.iso3, name: country.name, mentions });
    }
  }

  return results.sort((a, b) => b.mentions - a.mentions);
}

export function matchSegments(text: string, limit = 5): SegmentMatch[] {
  const { profiles, idf } = buildProfiles();

  const docTerms = new Map<string, number>();
  for (const token of tokenize(text)) {
    docTerms.set(token, (docTerms.get(token) ?? 0) + 1);
  }
  if (docTerms.size === 0) return [];

  // Repetition past a few mentions says nothing extra; a deck that says
  // "delivery" ninety times is not ninety times more about delivery.
  const capped = new Map<string, number>();
  for (const [term, count] of docTerms) capped.set(term, Math.min(count, 4));

  const scored = profiles.map((profile) => {
    let score = 0;
    const hits: Array<{ term: string; weight: number }> = [];

    for (const [term, segmentWeight] of profile.terms) {
      const docCount = capped.get(term);
      if (!docCount) continue;
      const contribution = segmentWeight * docCount * (idf.get(term) ?? 1);
      score += contribution;
      hits.push({ term, weight: contribution });
    }

    hits.sort((a, b) => b.weight - a.weight);

    return {
      segmentId: profile.segment.id,
      sectorId: profile.sector.id,
      name: profile.segment.name,
      sectorName: profile.sector.name,
      score,
      confidence: 0,
      evidence: hits.slice(0, 6).map((h) => h.term),
    } satisfies SegmentMatch;
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  if (best <= 0) return [];

  // Confidence is how far clear of the runner-up the winner is, not its raw
  // score: a document that matches six segments equally well has not been
  // identified, however high the numbers are.
  const runnerUp = scored[1]?.score ?? 0;
  const separation = best > 0 ? (best - runnerUp) / best : 0;

  return scored.slice(0, limit).map((match, i) => ({
    ...match,
    confidence:
      i === 0
        ? Math.max(0.15, Math.min(0.95, 0.45 + separation * 0.9))
        : Math.min(0.6, match.score / best),
  }));
}

/**
 * What the document proposes doing, as opposed to what the data suggests.
 *
 * The gap between the two is the single most useful thing this feature
 * produces: "you have written a plan to build a factory in a market whose
 * binding constraint is the grid" is worth more than any score.
 */
const ROUTE_SIGNALS: Array<{ route: EntryRouteId; patterns: RegExp[] }> = [
  {
    route: "substitute",
    patterns: [
      /\b(manufactur|factory|factories|production line|produce locally|local production|plant|processing facility|assembly line|import substitut)/i,
    ],
  },
  {
    route: "finish-local",
    patterns: [
      /\b(repack|re-pack|bottling|packaging line|blend|assemble|finishing|private label|white label|contract manufactur)/i,
    ],
  },
  {
    route: "distribute",
    patterns: [
      /\b(distribut|wholesal|import(er|ing)|reseller|dealership|agency|sole agent|supply chain partner|stockist)/i,
    ],
  },
  {
    route: "export",
    patterns: [/\b(export|overseas market|international market|diaspora|ship abroad)/i],
  },
  {
    route: "service",
    patterns: [
      /\b(platform|marketplace|app\b|saas|software|subscription|consult|agency service|on-demand|booking)/i,
    ],
  },
  {
    route: "formalise",
    patterns: [/\b(aggregat|informal|formalis|formaliz|cooperative|network of|onboard(ing)? (small|local))/i],
  },
  {
    route: "differentiate",
    patterns: [/\b(premium|boutique|artisan|specialty|niche|differentiat|underserved segment)/i],
  },
];

export interface RouteIntent {
  route: EntryRouteId | null;
  /** The phrase in the document that indicated it. */
  matched: string | null;
}

export function detectRouteIntent(text: string): RouteIntent {
  const counts = new Map<EntryRouteId, { hits: number; first: string }>();

  for (const { route, patterns } of ROUTE_SIGNALS) {
    for (const pattern of patterns) {
      const global = new RegExp(pattern.source, "gi");
      const found = text.match(global);
      if (found && found.length > 0) {
        const existing = counts.get(route);
        counts.set(route, {
          hits: (existing?.hits ?? 0) + found.length,
          first: existing?.first ?? found[0],
        });
      }
    }
  }

  if (counts.size === 0) return { route: null, matched: null };

  const [route, detail] = Array.from(counts.entries()).sort(
    (a, b) => b[1].hits - a[1].hits,
  )[0];
  return { route, matched: detail.first };
}

export function countryFromMatches(
  matches: CountryMatch[],
  fallback: Country,
): { country: string; detected: boolean } {
  const top = matches[0];
  // One passing mention is not a market declaration; require either repetition
  // or a clear lead over the runner-up.
  if (top && (top.mentions >= 3 || top.mentions > (matches[1]?.mentions ?? 0) * 2)) {
    return { country: top.iso3, detected: true };
  }
  return { country: fallback.iso3, detected: false };
}
