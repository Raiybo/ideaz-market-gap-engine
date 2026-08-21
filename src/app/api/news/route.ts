import { COUNTRY_BY_ISO3 } from "@/lib/domain/countries";
import { ALL_SEGMENTS } from "@/lib/domain/sectors";
import { fetchNews } from "@/lib/signals/news";

/**
 * News for one segment in one market, fetched on demand.
 *
 * Deliberately not part of the scan. GDELT allows roughly one request every
 * five seconds, so querying 73 segments would take six minutes and return
 * mostly noise; querying the one segment a reader has decided to care about
 * costs one request and answers the question they actually have.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Words that appear in segment names but say nothing a search can use. */
const GENERIC = new Set([
  "and", "the", "services", "service", "solutions", "products", "goods",
  "management", "platforms", "platform", "systems", "tech", "other", "general",
]);

/**
 * Search terms for a segment, derived from its name rather than curated per
 * segment. Segment names are already written to be distinctive ("Dairy &
 * Chilled", "Solar PV & Installation"), which is exactly what a query needs.
 */
function termsFor(name: string, description: string): string[] {
  const fromName = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));

  if (fromName.length >= 2) return fromName.slice(0, 4);

  // Very short names ("Bakery") get topped up from the description so the
  // query is not a single word competing with every other use of it.
  const fromDescription = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !GENERIC.has(w))
    .slice(0, 3);

  return [...fromName, ...fromDescription].slice(0, 4);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const countryIso3 = searchParams.get("country");
  const segmentId = searchParams.get("segment");

  const country = countryIso3 ? COUNTRY_BY_ISO3.get(countryIso3) : undefined;
  if (!country) {
    return Response.json({ error: "Unknown country" }, { status: 400 });
  }

  const found = ALL_SEGMENTS.find((s) => s.segment.id === segmentId);
  if (!found) {
    return Response.json({ error: "Unknown segment" }, { status: 400 });
  }

  const terms = termsFor(found.segment.name, found.segment.description);
  const signal = await fetchNews(terms, country.iso2);

  return Response.json({
    segmentId: found.segment.id,
    country: country.iso3,
    terms,
    ...signal,
  });
}
