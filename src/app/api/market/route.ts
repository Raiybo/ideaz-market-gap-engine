import { NextResponse } from "next/server";

import { analyzeSector } from "@/lib/engine/analyze";
import { COUNTRY_BY_ISO3, DEFAULT_COUNTRY } from "@/lib/domain/countries";
import { SECTOR_BY_ID, SECTORS } from "@/lib/domain/sectors";

export const revalidate = 3600;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country") ?? DEFAULT_COUNTRY;
  const sector = searchParams.get("sector") ?? SECTORS[0].id;

  if (!COUNTRY_BY_ISO3.has(country)) {
    return NextResponse.json(
      { error: `Unknown country code: ${country}` },
      { status: 400 },
    );
  }
  if (!SECTOR_BY_ID.has(sector)) {
    return NextResponse.json(
      { error: `Unknown sector: ${sector}` },
      { status: 400 },
    );
  }

  try {
    const analysis = await analyzeSector(country, sector);
    return NextResponse.json(analysis);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Analysis failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
