import { NextResponse } from "next/server";

import { COUNTRY_BY_ISO3 } from "@/lib/domain/countries";
import { expandToProductCodes, HS_DESCRIPTIONS } from "@/lib/domain/hs";
import { ALL_SEGMENTS } from "@/lib/domain/sectors";
import { fetchProductGaps, REPORTER_CODES } from "@/lib/signals/comtrade";
import { makeBundle } from "@/lib/signals/types";

export const revalidate = 604800;

/** Enough lines to see the shape of a category without burying the reader. */
const TOP_N = 12;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");
  const segmentId = searchParams.get("segment");
  const year = Number(searchParams.get("year"));

  if (!country || !COUNTRY_BY_ISO3.has(country)) {
    return NextResponse.json({ error: "Unknown country" }, { status: 400 });
  }

  const found = ALL_SEGMENTS.find((s) => s.segment.id === segmentId);
  if (!found) {
    return NextResponse.json({ error: "Unknown segment" }, { status: 400 });
  }
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json(
      { error: "A valid reporting year is required" },
      { status: 400 },
    );
  }

  if (!REPORTER_CODES[country]) {
    return NextResponse.json(
      { error: `${country} does not report to UN Comtrade.` },
      { status: 422 },
    );
  }

  const { segment } = found;
  if (segment.hsCodes.length === 0) {
    return NextResponse.json(
      { error: "This is a services segment with no customs footprint." },
      { status: 422 },
    );
  }

  const codes6 = expandToProductCodes(segment.hsCodes);
  const bundle = makeBundle(country);

  try {
    const products = await fetchProductGaps(
      country,
      codes6,
      HS_DESCRIPTIONS,
      year,
      bundle,
    );

    return NextResponse.json({
      segmentId: segment.id,
      year,
      lineCount: codes6.length,
      products: products.slice(0, TOP_N),
      warnings: bundle.warnings,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Product lookup failed.",
      },
      { status: 500 },
    );
  }
}
