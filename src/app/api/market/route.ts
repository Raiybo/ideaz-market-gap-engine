import { NextResponse } from "next/server";

import { scanCountry } from "@/lib/engine/scan";

/**
 * Legacy JSON endpoint, kept for scripted callers.
 *
 * It now delegates to the same scan the UI uses rather than carrying its own
 * orchestration — two code paths that resolved a country's operating
 * conditions differently would eventually disagree, and the one nobody looks
 * at would be the one that was wrong.
 */
export const revalidate = 3600;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");
  const sector = searchParams.get("sector");

  if (!country) {
    return NextResponse.json(
      { error: "A country parameter is required." },
      { status: 400 },
    );
  }

  try {
    const scan = await scanCountry(country, {
      sectorId: sector && sector !== "all" ? sector : undefined,
      drillDown: searchParams.get("drill") === "1",
    });
    return NextResponse.json(scan);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    const unknown = message.startsWith("Unknown");
    return NextResponse.json({ error: message }, { status: unknown ? 400 : 500 });
  }
}
