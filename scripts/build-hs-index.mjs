/**
 * Regenerates src/lib/domain/hs-index.json.
 *
 * Pulls the HS 2022 (H6) classification from UN Comtrade and keeps only the
 * 6-digit leaf codes belonging to chapters our sector taxonomy actually
 * references. Bundling this rather than fetching at request time keeps the
 * product drill-down independent of a second live dependency.
 *
 * Run with: node scripts/build-hs-index.mjs
 */

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SECTORS = join(ROOT, "src/lib/domain/sectors.ts");
const OUT = join(ROOT, "src/lib/domain/hs-index.json");
const SOURCE = "https://comtradeapi.un.org/files/v1/app/reference/H6.json";

const source = await readFile(SECTORS, "utf8");
const codes = new Set();
for (const block of source.matchAll(/hsCodes:\s*\[([^\]]*)\]/g)) {
  for (const code of block[1].matchAll(/"(\d+)"/g)) codes.add(code[1]);
}
const chapters = new Set([...codes].map((c) => c.slice(0, 2)));

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Comtrade reference fetch failed: ${res.status}`);
const body = await res.json();
const rows = body.results ?? body;

const index = {};
for (const row of rows) {
  const id = String(row.id);
  if (id.length !== 6) continue;
  if (!chapters.has(id.slice(0, 2))) continue;
  // Reference text is prefixed with the code itself; strip it.
  index[id] = String(row.text).replace(/^\d+\s*-\s*/, "");
}

await writeFile(OUT, JSON.stringify(index), "utf8");
console.log(
  `Wrote ${Object.keys(index).length} codes across ${chapters.size} chapters to ${OUT}`,
);
