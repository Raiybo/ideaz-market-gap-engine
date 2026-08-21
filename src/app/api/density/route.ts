import { COUNTRY_BY_ISO3 } from "@/lib/domain/countries";
import { ALL_SEGMENTS } from "@/lib/domain/sectors";
import { fetchDensity } from "@/lib/signals/osm";
import { makeBundle } from "@/lib/signals/types";

/**
 * Observed premise density for a country, fetched without a deadline.
 *
 * The scan bounds its wait on OpenStreetMap so a cold country cannot blow the
 * function budget — but a bounded fetch that gets abandoned never completes,
 * so it never populates the cache either, and every subsequent scan pays the
 * same cold cost and gives up at the same point. This endpoint is what breaks
 * that loop: it runs the query to completion, caches it for thirty days, and
 * returns the counts so the page can show them immediately. The next scan of
 * that country then finds them warm and folds them into the ranking.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const iso3 = searchParams.get("country");
  const country = iso3 ? COUNTRY_BY_ISO3.get(iso3) : undefined;

  if (!country) {
    return Response.json({ error: "Unknown country" }, { status: 400 });
  }

  const bundle = makeBundle(country.iso3);
  const segmentIds = ALL_SEGMENTS.map((s) => s.segment.id);

  const result = await fetchDensity(
    country.iso2,
    segmentIds,
    // Per-million figures are the one field that needs population; the scan
    // has it and this endpoint does not, so it is reported as zero and the
    // page uses the saturation ratio, which does not depend on it.
    0,
    bundle,
  ).catch(() => null);

  if (!result || !result.available) {
    return Response.json({
      available: false,
      universe: 0,
      bySegment: {},
      warnings: bundle.warnings,
    });
  }

  return Response.json({
    available: true,
    universe: result.universe,
    bySegment: Object.fromEntries(result.bySegment),
    warnings: bundle.warnings,
  });
}
