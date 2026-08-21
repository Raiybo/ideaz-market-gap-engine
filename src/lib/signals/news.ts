/**
 * News signal.
 *
 * Every other source here lags: Comtrade publishes a year in arrears, World
 * Bank one to three. That is fine for measuring a structural gap and useless
 * for the question that actually kills a plan — "did someone announce a plant
 * last month?" A gap that was real in 2024 can be closed by a single funded
 * entrant in 2026, and nothing else in this system would notice.
 *
 * GDELT is used rather than a general news search for one specific reason:
 * `sourcecountry:` filtering. A plain query for Lebanon and dairy returns
 * Lebanon, Pennsylvania and Lebanon, Missouri — in testing, every result. A
 * source-country filter is what makes the difference between a signal and
 * noise dressed as one, so there is no fallback to an unfiltered search: no
 * signal is reported rather than a confidently wrong one.
 */

import { NULL_TRACER, type Tracer } from "../engine/trace";

const GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";

/**
 * GDELT asks for one request every five seconds and enforces it by returning a
 * plain-text scolding with HTTP 200 — not a 429. An unguarded caller parses
 * that as "no articles" and reports a quiet market, which is the exact
 * false negative this signal exists to prevent.
 */
const MIN_INTERVAL_MS = 6000;
const RATE_LIMIT_MARKER = "please limit requests";

let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

export interface Article {
  title: string;
  url: string;
  domain: string;
  /** GDELT's seendate, normalised to ISO. */
  seenAt: string;
}

export type NewsStatus = "ok" | "empty" | "unavailable" | "unsupported";

export interface NewsSignal {
  status: NewsStatus;
  /** Articles in the recent window, newest first. */
  articles: Article[];
  /** Articles whose headline reads as new capacity being built. */
  capacity: Article[];
  /** Window queried, in months. */
  months: number;
  message: string;
}

export const EMPTY_NEWS: NewsSignal = {
  status: "unavailable",
  articles: [],
  capacity: [],
  months: 0,
  message: "No news signal was retrieved.",
};

/**
 * Headline patterns that mean someone is adding supply to this market — the
 * single most decision-relevant thing news can tell you here, because it is
 * what turns an open gap into a race.
 */
const CAPACITY_PATTERNS = [
  /\b(open(s|ed|ing)?|launch(es|ed|ing)?|unveil(s|ed)?)\b.{0,40}\b(plant|factory|facility|line|mill|plantation|warehouse|hub)\b/i,
  /\b(new|first)\b.{0,30}\b(plant|factory|facility|production line|processing)\b/i,
  /\b(invest(s|ed|ing|ment)?|fund(s|ed|ing)?|raise[sd]?)\b.{0,40}\b(plant|factory|facility|capacity|production|expansion)\b/i,
  /\b(expand(s|ed|ing)?|scale[sd]? up|double[sd]? capacity|boost(s|ed)? (output|production|capacity))\b/i,
  /\b(joint venture|partnership)\b.{0,40}\b(produce|manufacture|plant|factory)\b/i,
  /\b(begins|starts|commences)\b.{0,30}\b(production|manufacturing|operations)\b/i,
];

function isCapacityNews(title: string): boolean {
  return CAPACITY_PATTERNS.some((p) => p.test(title));
}

/** GDELT returns seendate as YYYYMMDDTHHMMSSZ. */
function parseSeenDate(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw ?? "");
  if (!m) return raw ?? "";
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

interface GdeltArticle {
  title?: string;
  url?: string;
  domain?: string;
  seendate?: string;
}

/**
 * Build the query. Terms are OR'd inside parentheses and constrained to outlets
 * publishing from the country, which is what disambiguates place names.
 */
function buildQuery(terms: string[], iso2: string): string {
  const cleaned = terms
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3 && t.length <= 30)
    .slice(0, 6);
  if (cleaned.length === 0) return "";
  const phrase = cleaned
    .map((t) => (t.includes(" ") ? `"${t}"` : t))
    .join(" OR ");
  return `(${phrase}) sourcecountry:${iso2.toUpperCase()}`;
}

const WINDOW_MONTHS = 6;
const MAX_RECORDS = 20;

export async function fetchNews(
  terms: string[],
  iso2: string,
  tracer: Tracer = NULL_TRACER,
  nodeId?: string,
): Promise<NewsSignal> {
  const query = buildQuery(terms, iso2);
  if (!query) {
    return {
      ...EMPTY_NEWS,
      status: "unsupported",
      message: "This segment has no distinctive search terms to query on.",
    };
  }

  const params = new URLSearchParams({
    query,
    mode: "artlist",
    maxrecords: String(MAX_RECORDS),
    format: "json",
    timespan: `${WINDOW_MONTHS}months`,
    sort: "datedesc",
  });

  try {
    const { status, body } = await throttled(async () => {
      // The abort timer starts here, not before the queue — a request waiting
      // its turn behind others has not started yet, and timing the wait would
      // abort exactly the requests the throttle is protecting.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(`${GDELT_ENDPOINT}?${params}`, {
          signal: controller.signal,
          // News moves, but not by the minute at this granularity; six hours
          // keeps the free endpoint usable and the answer current enough.
          next: { revalidate: 21600 },
          headers: {
            accept: "application/json",
            // GDELT asks callers to identify themselves.
            "user-agent":
              "Ideaz-MarketGapEngine/1.0 (market gap research tool)",
          },
        });
        return { status: res.status, body: await res.text() };
      } finally {
        clearTimeout(timeout);
      }
    });

    // Rate limiting arrives as a 429 carrying a plain-text explanation, and has
    // also been observed with a 200. Detect it either way: parsed as JSON it
    // becomes an empty result, which reads as a quiet market — the exact false
    // negative this signal exists to prevent.
    if (status === 429 || body.toLowerCase().includes(RATE_LIMIT_MARKER)) {
      tracer.status(nodeId ?? "src:news", "error", {
        detail: "GDELT rate limit — no news signal this run",
      });
      return {
        ...EMPTY_NEWS,
        months: WINDOW_MONTHS,
        message:
          "GDELT is rate limiting this instance, so no news signal was retrieved. It allows roughly one request every five seconds; try again shortly.",
      };
    }

    if (status >= 400) {
      return {
        ...EMPTY_NEWS,
        months: WINDOW_MONTHS,
        message: `GDELT returned HTTP ${status}; no news signal was retrieved.`,
      };
    }

    let parsed: { articles?: GdeltArticle[] };
    try {
      parsed = JSON.parse(body) as { articles?: GdeltArticle[] };
    } catch {
      return {
        ...EMPTY_NEWS,
        months: WINDOW_MONTHS,
        message: "GDELT returned a response that could not be read as JSON.",
      };
    }

    const articles: Article[] = (parsed.articles ?? [])
      .filter((a) => a.title && a.url)
      .map((a) => ({
        title: String(a.title),
        url: String(a.url),
        domain: String(a.domain ?? ""),
        seenAt: parseSeenDate(String(a.seendate ?? "")),
      }));

    const capacity = articles.filter((a) => isCapacityNews(a.title));

    if (articles.length === 0) {
      tracer.status(nodeId ?? "src:news", "empty", {
        detail: `No coverage in the last ${WINDOW_MONTHS} months`,
      });
      return {
        status: "empty",
        articles: [],
        capacity: [],
        months: WINDOW_MONTHS,
        message: `No coverage of this category in ${iso2.toUpperCase()}-published news over the last ${WINDOW_MONTHS} months. That is weak evidence of a quiet market, not proof of one — local outlets are unevenly indexed.`,
      };
    }

    tracer.status(nodeId ?? "src:news", "ok", {
      detail: `${articles.length} articles, ${capacity.length} about new capacity`,
    });

    return {
      status: "ok",
      articles,
      capacity,
      months: WINDOW_MONTHS,
      message:
        capacity.length > 0
          ? `${capacity.length} of ${articles.length} recent articles read as new capacity being built. Check these before treating the gap as open.`
          : `${articles.length} recent articles, none of which read as new capacity being announced.`,
    };
  } catch (err) {
    tracer.status(nodeId ?? "src:news", "error", {
      detail: err instanceof Error ? err.message : "Request failed",
    });
    return {
      ...EMPTY_NEWS,
      months: WINDOW_MONTHS,
      message: `News lookup failed (${err instanceof Error ? err.message : "unknown error"}).`,
    };
  }
}
