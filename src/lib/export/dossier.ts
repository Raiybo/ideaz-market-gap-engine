/**
 * The saved angle: everything known about one niche, in one file.
 *
 * Two artefacts come out of here and they are for different readers. The
 * markdown is for a person — the whole field, the country it sits in, the one
 * segment the survey was answered against, and the reasoning that produced the
 * route, in the order someone would want to read it months later with no
 * memory of the session. The JSON is for the next program: same content,
 * structured, so two saved angles can be compared or merged without parsing
 * prose back into numbers.
 *
 * Everything written here already exists in the scan. Nothing is recomputed and
 * nothing is invented — a dossier that disagreed with the page it was saved
 * from would be worse than no dossier.
 */

import type { ConditionField } from "../domain/conditions";
import type { OperatorFit, OperatorProfile } from "../engine/operator";
import type { CountryScan, Finding } from "../engine/scan";

export interface AngleRecord {
  /** Schema marker, so a later merge can reject files it does not understand. */
  kind: "ideaz.angle";
  version: 1;
  savedAt: string;
  country: CountryScan["country"];
  scope: CountryScan["scope"];
  sector: CountryScan["sector"];
  segment: {
    id: string;
    name: string;
    description: string;
    score: number;
    confidence: number;
    components: Finding["components"];
    addressableUsd: number | null;
    timeToRevenueMonths: number;
    tradeGap: Finding["tradeGap"];
    density: Finding["density"];
    beachhead: Finding["beachhead"];
    evidence: Finding["evidence"];
    risks: string[];
  };
  playbook: Finding["playbook"];
  profile: OperatorProfile;
  fit: OperatorFit;
  /** Every segment scored in the same scan, so the field is captured too. */
  field: Array<{
    id: string;
    name: string;
    score: number;
    addressableUsd: number | null;
    route: string;
    observed: boolean;
  }>;
  macro: CountryScan["macro"];
  conditions: ConditionField[];
  warnings: string[];
  scanGeneratedAt: string;
}

const PROFILE_LABELS: Record<keyof OperatorProfile, Record<string, string>> = {
  capital: {
    "under-50k": "Under $50K",
    "50k-250k": "$50K – $250K",
    "250k-1m": "$250K – $1M",
    "over-1m": "$1M+",
  },
  build: {
    distribute: "Sell and distribute",
    assemble: "Assemble and finish",
    manufacture: "Manufacture end to end",
    software: "Software and services",
  },
  horizon: {
    "6mo": "Within 6 months",
    "2yr": "Within 2 years",
    "3yr-plus": "3 years or more",
  },
  team: {
    solo: "Just me",
    commercial: "Commercial team",
    engineering: "Engineering team",
    "hardware-ops": "Hardware and operations",
  },
  regulatory: {
    avoid: "Avoid licensed sectors",
    permits: "Permits and inspections are fine",
    controlled: "Including controlled goods",
  },
};

const VERDICT_LABEL: Record<OperatorFit["verdict"], string> = {
  fits: "Fits what you have",
  stretch: "Reachable, with strain",
  blocked: "Not reachable as you are",
};

function usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${sign}$${(v / 1e3).toFixed(0)}K`;
  return `${sign}$${v.toFixed(0)}`;
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/**
 * Folder name for one saved angle.
 *
 * Country and segment lead because that is what a person scans a directory
 * for, and the date trails so re-saving the same angle later sits beside the
 * original rather than overwriting it — the scores will have moved, and that
 * movement is worth keeping.
 */
export function angleFolderName(
  scan: CountryScan,
  finding: Finding,
  savedAt: Date,
): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
  const day = savedAt.toISOString().slice(0, 10);
  const time = savedAt.toISOString().slice(11, 16).replace(":", "");
  return `${scan.country.iso3}-${slug(finding.name)}-${day}-${time}`;
}

export function buildAngleRecord(
  scan: CountryScan,
  finding: Finding,
  profile: OperatorProfile,
  fit: OperatorFit,
  savedAt: Date,
): AngleRecord {
  return {
    kind: "ideaz.angle",
    version: 1,
    savedAt: savedAt.toISOString(),
    country: scan.country,
    scope: scan.scope,
    sector: scan.sector,
    segment: {
      id: finding.segmentId,
      name: finding.name,
      description: finding.description,
      score: finding.score,
      confidence: finding.confidence,
      components: finding.components,
      addressableUsd: finding.addressableUsd,
      timeToRevenueMonths: finding.timeToRevenueMonths,
      tradeGap: finding.tradeGap,
      density: finding.density,
      beachhead: finding.beachhead,
      evidence: finding.evidence,
      risks: finding.risks,
    },
    playbook: finding.playbook,
    profile,
    fit,
    field: scan.findings.map((f) => ({
      id: f.segmentId,
      name: f.name,
      score: f.score,
      addressableUsd: f.addressableUsd,
      route: f.playbook.routeName,
      observed: Boolean(f.tradeGap?.observed),
    })),
    macro: scan.macro,
    conditions: scan.conditionFields,
    warnings: scan.warnings,
    scanGeneratedAt: scan.generatedAt,
  };
}

export function buildDossierMarkdown(record: AngleRecord): string {
  const r = record;
  const g = r.segment.tradeGap;
  const L: string[] = [];

  L.push(`# ${r.segment.name} — ${r.country.name}`);
  L.push("");
  L.push(
    `${r.sector ? r.sector.name : "Whole country"} · saved ${r.savedAt.slice(0, 16).replace("T", " ")} · scan of ${r.scanGeneratedAt.slice(0, 10)}`,
  );
  L.push("");
  L.push(`> ${r.playbook.headline}`);
  L.push("");

  // --- The verdict, first, because it is why this file exists.
  L.push("## Your angle");
  L.push("");
  L.push(`**${VERDICT_LABEL[r.fit.verdict]}** — ${r.fit.routeName}`);
  L.push("");
  if (r.fit.routeChanged) {
    L.push(
      `The market alone pointed to *${r.fit.defaultRouteName}*. Your answers moved it to *${r.fit.routeName}*.`,
    );
    L.push("");
  }
  L.push(`- Capital band: **${r.fit.capital.label}**`);
  L.push(`- Time to first revenue: **${r.segment.timeToRevenueMonths} months**`);
  if (r.fit.capitalShortfallUsd !== null) {
    L.push(`- Capital shortfall: **${usd(r.fit.capitalShortfallUsd)}**`);
  }
  if (r.fit.monthsOverHorizon !== null) {
    L.push(`- Past your deadline by: **${r.fit.monthsOverHorizon} months**`);
  }
  L.push("");

  if (r.fit.blockers.length) {
    L.push("### What blocks this");
    L.push("");
    for (const b of r.fit.blockers) L.push(`- ${b}`);
    L.push("");
  }
  if (r.fit.reasons.length) {
    L.push("### Why this route");
    L.push("");
    for (const x of r.fit.reasons) L.push(`- ${x}`);
    L.push("");
  }
  if (r.fit.strains.length) {
    L.push("### What will strain");
    L.push("");
    for (const x of r.fit.strains) L.push(`- ${x}`);
    L.push("");
  }

  L.push("### Answers this was built from");
  L.push("");
  for (const key of Object.keys(PROFILE_LABELS) as Array<keyof OperatorProfile>) {
    L.push(`- **${key}**: ${PROFILE_LABELS[key][r.profile[key]] ?? r.profile[key]}`);
  }
  L.push("");

  // --- The gap itself.
  L.push("## The gap");
  L.push("");
  L.push(r.playbook.finding);
  L.push("");
  L.push(`| | |`);
  L.push(`|---|---|`);
  L.push(`| Score | ${r.segment.score.toFixed(1)} / 100 |`);
  L.push(`| Confidence | ${pct(r.segment.confidence)} |`);
  L.push(`| Addressable | ${usd(r.segment.addressableUsd)} per year |`);
  if (g) {
    L.push(`| Imports (${g.year}) | ${usd(g.imports)} |`);
    L.push(`| Exports (${g.year}) | ${usd(g.exports)} |`);
    L.push(`| Net imports | ${usd(g.netImports)} |`);
    L.push(`| Import dependency | ${pct(g.importDependency)} |`);
    L.push(
      `| Trend | ${g.trendPct === null ? "—" : `${g.trendPct > 0 ? "widening" : "closing"} ${Math.abs(g.trendPct).toFixed(1)}%/yr since ${g.trendBaseYear}`} |`,
    );
    L.push(`| Measured | ${g.observed ? "yes, from customs data" : "modelled"} |`);
  } else {
    L.push(`| Measured | no customs footprint — modelled |`);
  }
  if (r.segment.density) {
    L.push(
      `| Mapped premises | ${r.segment.density.count.toLocaleString()} ${r.segment.density.label} (${r.segment.density.saturation.toFixed(2)}x typical) |`,
    );
  }
  L.push("");

  L.push("### Score components");
  L.push("");
  for (const [k, v] of Object.entries(r.segment.components)) {
    L.push(`- ${k}: ${Number(v).toFixed(0)}`);
  }
  L.push("");

  if (r.segment.beachhead) {
    const b = r.segment.beachhead;
    L.push("### Start with one line, not the category");
    L.push("");
    L.push(`**HS ${b.hsCode}** — ${b.description}`);
    L.push("");
    L.push(
      `${usd(b.netImports)} net imports · ${pct(b.importDependency)} import dependent — the largest single gap inside this segment.`,
    );
    L.push("");
  }

  // --- The plan, verbatim from the playbook.
  L.push("## The plan");
  L.push("");
  L.push(`**${r.playbook.routeName}** · ${r.playbook.capital.label} to start · ~${r.playbook.timeToRevenueMonths} months to first revenue`);
  L.push("");
  L.push(r.playbook.thesis);
  L.push("");
  if (r.playbook.revenueMath.length) {
    L.push("### If you capture");
    L.push("");
    for (const line of r.playbook.revenueMath) L.push(`- ${line}`);
    L.push("");
  }
  L.push("### First moves");
  L.push("");
  r.playbook.firstMoves.forEach((m, i) => L.push(`${i + 1}. ${m}`));
  L.push("");
  L.push("### Cheapest way to prove it wrong");
  L.push("");
  L.push(r.playbook.provingTest);
  L.push("");
  L.push("### Who pays");
  L.push("");
  for (const b of r.playbook.buyers) L.push(`- ${b}`);
  L.push("");
  L.push("### What kills it");
  L.push("");
  for (const k of r.playbook.killers) L.push(`- ${k}`);
  L.push("");

  // --- The rest of the field, so the niche has context.
  L.push(`## The rest of the field${r.sector ? ` — ${r.sector.name}` : ""}`);
  L.push("");
  L.push(`| # | Segment | Score | Addressable | Route | Measured |`);
  L.push(`|---|---|---|---|---|---|`);
  r.field.forEach((f, i) => {
    const mark = f.id === r.segment.id ? " ←" : "";
    L.push(
      `| ${i + 1} | ${f.name}${mark} | ${f.score.toFixed(1)} | ${usd(f.addressableUsd)} | ${f.route} | ${f.observed ? "yes" : "modelled"} |`,
    );
  });
  L.push("");

  // --- The country.
  L.push(`## ${r.country.name} — the market`);
  L.push("");
  L.push(`${r.country.region} · ${r.country.iso3}`);
  L.push("");
  L.push(`| Indicator | Value | Period | Source |`);
  L.push(`|---|---|---|---|`);
  for (const m of r.macro) {
    L.push(`| ${m.label} | ${m.value} | ${m.period} | ${m.source} |`);
  }
  L.push("");
  L.push("### Operating conditions");
  L.push("");
  L.push(`| Condition | Value | Provenance | Basis |`);
  L.push(`|---|---|---|---|`);
  for (const c of r.conditions) {
    L.push(
      `| ${c.label} | ${pct(c.value)} | ${c.provenance} | ${c.basis.replace(/\|/g, "/")} |`,
    );
  }
  L.push("");

  // --- Evidence, so every number above can be traced.
  L.push("## Evidence");
  L.push("");
  for (const e of r.segment.evidence) {
    L.push(`### ${e.label} *(${e.provenance})*`);
    L.push("");
    L.push(e.detail);
    L.push("");
    L.push(`Source: ${e.source}`);
    L.push("");
  }

  if (r.warnings.length) {
    L.push("## Data caveats");
    L.push("");
    for (const w of r.warnings) L.push(`- ${w}`);
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push(
    `Saved from the Ideaz market gap engine. \`angle.json\` beside this file holds the same content structured, for merging with other saved angles.`,
  );

  return L.join("\n");
}
