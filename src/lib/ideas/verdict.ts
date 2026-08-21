/**
 * Judge an idea someone already has.
 *
 * The scan answers "what should I do here". This answers a harder and more
 * useful question: "I already intend to do this — is it any good, and what
 * would make it better". The engine has the same evidence either way; what
 * changes is that the segment is given rather than chosen, so the verdict has
 * to be willing to come back negative.
 *
 * It is deliberately structured as standing / for / against / how to strengthen
 * rather than a single number. A score alone invites the reader to argue with
 * the number; naming the specific component that is failing and the figure
 * behind it invites them to fix it.
 */

import type { MarketConditions } from "../domain/countries";
import type { EntryRouteId } from "../engine/playbook";
import type { CountryScan, Finding } from "../engine/scan";
import { formatUsd } from "../engine/score";
import type { RouteIntent, SegmentMatch } from "./match";

export type Standing = "strong" | "workable" | "conditional" | "weak";

export interface Point {
  label: string;
  detail: string;
}

export interface RouteVerdict {
  proposed: EntryRouteId | null;
  proposedName: string | null;
  /** The phrase in the document that revealed the intent. */
  proposedEvidence: string | null;
  recommended: EntryRouteId;
  recommendedName: string;
  agrees: boolean;
  detail: string;
}

export interface IdeaVerdict {
  standing: Standing;
  headline: string;
  /** Plain-language summary of the judgement, two to four sentences. */
  summary: string;
  rank: number;
  totalScored: number;
  percentile: number;
  supports: Point[];
  againsts: Point[];
  route: RouteVerdict;
  strengthen: Point[];
  killCriteria: string[];
  /** Honest caveat about how confidently the document was matched. */
  matchNote: string;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const ROUTE_NAMES: Record<EntryRouteId, string> = {
  substitute: "Make it here",
  "finish-local": "Import bulk, finish locally",
  distribute: "Own the channel",
  export: "Sell it outward",
  service: "Build the missing service",
  formalise: "Aggregate what is already there",
  differentiate: "Enter on a wedge",
};

const STANDING_HEADLINE: Record<Standing, string> = {
  strong: "The data backs this",
  workable: "Workable, with conditions",
  conditional: "Only under specific conditions",
  weak: "The data does not support this",
};

/**
 * Route disagreements are not all equal. Proposing to manufacture where the
 * data says distribute is a capital-structure error worth flagging loudly;
 * proposing to distribute where the data says finish locally is a smaller
 * difference of degree.
 */
function routeVerdict(
  intent: RouteIntent,
  recommended: EntryRouteId,
  finding: Finding,
  conditions: MarketConditions,
): RouteVerdict {
  const base = {
    proposed: intent.route,
    proposedName: intent.route ? ROUTE_NAMES[intent.route] : null,
    proposedEvidence: intent.matched,
    recommended,
    recommendedName: ROUTE_NAMES[recommended],
  };

  if (!intent.route) {
    return {
      ...base,
      agrees: true,
      detail: `The document does not commit to a specific way in, so there is nothing to disagree with. On this data the route that fits the market is "${ROUTE_NAMES[recommended]}" — worth deciding explicitly rather than by default.`,
    };
  }

  if (intent.route === recommended) {
    return {
      ...base,
      agrees: true,
      detail: `The document proposes "${ROUTE_NAMES[intent.route]}" and that is what the data points to as well. That agreement is worth something: the most common failure in this kind of plan is picking a route that the market's binding constraint rules out.`,
    };
  }

  const explanations: Partial<Record<EntryRouteId, string>> = {
    distribute: `Local production is the harder path here — this segment is ${(finding.components.feasibility).toFixed(0)}/100 on feasibility, with infrastructure dependence running into ${(conditions.gridReliability * 100).toFixed(0)}% grid reliability. The flow you are targeting already exists; controlling how it reaches the customer captures a margin on all of it without financing a build.`,
    "finish-local": `Financing scores ${(conditions.capitalScarcity * 100).toFixed(0)}% scarce in this market, which is what makes the full plant the wrong first step. The finishing stage carries a disproportionate share of the value at a fraction of the capital — the same thesis, entered at a scale you can actually fund.`,
    substitute: `The imported product carries freight, duty and an importer's margin before it reaches a shelf here. That stack is the headroom a local producer has, and this segment is ${(finding.components.feasibility).toFixed(0)}/100 feasible — the constraint you are routing around may not be binding.`,
    differentiate: `The premises data says this category is already ${finding.density?.saturation.toFixed(2) ?? "1.00"}x typical density. Entering on availability puts you in a price fight with incumbents who are already paid for; the opening that remains is the tier or geography they serve badly.`,
    export: `The trade balance shows a domestic production base already exists here. The scarce thing is not supply, it is reach — which makes selling outward the position with room in it.`,
    service: `This segment leaves no customs footprint, so the gap is in provision rather than in goods crossing a border. The work is execution and trust, not capital.`,
    formalise: `Informality runs at ${(conditions.informality * 100).toFixed(0)}% here. The activity already exists; what is missing is the infrastructure around it — terms, consistency, traceability — which is a durable position because incumbents cannot follow without changing what they are.`,
  };

  return {
    ...base,
    agrees: false,
    detail: `The document points at "${ROUTE_NAMES[intent.route]}"${intent.matched ? ` (the language that gives it away: "${intent.matched.trim()}")` : ""}, but on this market's data the route with room in it is "${ROUTE_NAMES[recommended]}". ${explanations[recommended] ?? ""} This is the single change most likely to alter the outcome, and it is cheaper to make now than after capital is committed.`,
  };
}

function standingFor(finding: Finding): Standing {
  const { score, components, density, tradeGap } = finding;

  // Specific disqualifiers override the headline score: a good composite built
  // on a market that is closing or already saturated is not a good entry.
  const closingFast = (tradeGap?.trendPct ?? 0) < -10;
  const saturated = (density?.saturation ?? 0) > 1.7;
  const infeasible = components.feasibility < 34;

  if (infeasible) return "weak";
  if (score >= 62 && !closingFast && !saturated) return "strong";
  if (score >= 55 && !infeasible) return closingFast || saturated ? "conditional" : "workable";
  if (score >= 45) return "conditional";
  return "weak";
}

export function buildVerdict(input: {
  finding: Finding;
  scan: CountryScan;
  match: SegmentMatch;
  intent: RouteIntent;
}): IdeaVerdict {
  const { finding, scan, match, intent } = input;
  const conditions = scan.conditions;

  const rank = scan.findings.findIndex((f) => f.segmentId === finding.segmentId) + 1;
  const total = scan.findings.length;
  const percentile = total > 0 ? Math.round(((total - rank) / total) * 100) : 0;

  const standing = standingFor(finding);
  const supports: Point[] = [];
  const againsts: Point[] = [];
  const strengthen: Point[] = [];
  const killCriteria: string[] = [];

  const gap = finding.tradeGap;

  // ---- What is working for it -------------------------------------------
  if (gap?.observed && gap.netImports > 0) {
    supports.push({
      label: "The demand is measured, not assumed",
      detail: `${scan.country.name} paid ${formatUsd(gap.imports)} for this category in ${gap.year} and sold ${formatUsd(gap.exports)} back out. ${(gap.importDependency * 100).toFixed(0)}% of what the market consumes is made elsewhere — that is a customs record, not an estimate.`,
    });
  }
  if (gap?.trendPct !== null && gap?.trendPct !== undefined && gap.trendPct > 4) {
    supports.push({
      label: "The market is moving your way",
      detail: `Net imports have grown ${gap.trendPct.toFixed(1)}% a year since ${gap.trendBaseYear}. Domestic supply is falling further behind demand, so the opening is still widening rather than being competed away.`,
    });
  }
  if (finding.density && finding.density.saturation < 0.85) {
    supports.push({
      label: "The supply side is genuinely thin",
      detail: `${finding.density.count.toLocaleString()} ${finding.density.label} are mapped in the country — ${finding.density.saturation.toFixed(2)}x typical density. This is the one signal here that measures competitors directly rather than inferring them.`,
    });
  }
  if (finding.components.feasibility >= 60) {
    supports.push({
      label: "Executable in this market",
      detail: `Feasibility scores ${finding.components.feasibility.toFixed(0)}/100 once local capital scarcity, grid reliability and bureaucratic friction are applied to the segment's own requirements. Fewer plans fail on the market than on the market's conditions.`,
    });
  }
  if (percentile >= 75) {
    supports.push({
      label: `Top ${100 - percentile}% of everything scored here`,
      detail: `Against ${total} segments across 16 sectors in ${scan.country.name}, this ranks ${rank}. You did not pick a bad room to be in.`,
    });
  }

  // ---- What is working against it ---------------------------------------
  if (gap?.trendPct !== null && gap?.trendPct !== undefined && gap.trendPct < -4) {
    againsts.push({
      label: "The gap is closing",
      detail: `Net imports have shrunk ${Math.abs(gap.trendPct).toFixed(1)}% a year since ${gap.trendBaseYear}. Someone is already building the capacity you are proposing to build. Find out who before committing — entering behind a funded incumbent is a different business than entering an empty market.`,
    });
    killCriteria.push(
      `You find an existing domestic producer with more capacity or capital than you can raise. The trade trajectory says one probably exists.`,
    );
  }
  if (finding.density && finding.density.saturation > 1.3) {
    againsts.push({
      label: "Already densely served on the ground",
      detail: `${finding.density.count.toLocaleString()} ${finding.density.label} are mapped here — ${finding.density.saturation.toFixed(2)}x typical density, against a reference share of ${(finding.density.referenceShare * 100).toFixed(1)}%. Availability is not what is missing, so an entry that competes on being available competes on price.`,
    });
  }
  if (finding.components.feasibility < 50) {
    againsts.push({
      label: "Hard to execute here specifically",
      detail: `Feasibility is ${finding.components.feasibility.toFixed(0)}/100. This segment needs ${(finding.components.feasibility < 40 ? "more" : "some")} of what this market is short of — grid at ${(conditions.gridReliability * 100).toFixed(0)}%, financing ${(conditions.capitalScarcity * 100).toFixed(0)}% scarce, bureaucratic friction ${(conditions.bureaucraticFriction * 100).toFixed(0)}%.`,
    });
  }
  if (!gap?.observed) {
    againsts.push({
      label: "The size is modelled, not observed",
      detail: `This segment leaves no customs footprint, so its ${finding.addressableUsd ? formatUsd(finding.addressableUsd) : "addressable figure"} is inferred from macro indicators rather than measured. Treat it as directional. Everything the engine says about size here is weaker than what it says about a goods segment.`,
    });
    killCriteria.push(
      `Three prospective customers decline to commit on paper. With no customs record behind the estimate, real commitments are the only hard evidence available.`,
    );
  }
  if (finding.components.momentum < 25) {
    againsts.push({
      label: "The economy is moving against you",
      detail: `Momentum scores ${finding.components.momentum.toFixed(0)}/100 — the macro trend in ${scan.country.name} is contraction, not growth. A widening import gap in a shrinking economy can mean demand is being met abroad because local capacity is failing, which is an opportunity, or because purchasing power is falling, which is not.`,
    });
  }
  if (!scan.conditionsCurated) {
    againsts.push({
      label: "Country conditions are not researched",
      detail: `${scan.country.name} has no individually researched operating conditions in this system, so grid, currency, financing and informality use neutral defaults. The feasibility half of this verdict is materially weaker than the demand half.`,
    });
  }

  // ---- How to make it better --------------------------------------------
  const route = routeVerdict(intent, finding.playbook.route, finding, conditions);
  if (!route.agrees) {
    strengthen.push({
      label: `Switch the route to "${route.recommendedName}"`,
      detail: route.detail,
    });
  }

  if (finding.beachhead) {
    strengthen.push({
      label: "Narrow to one product line before anything else",
      detail: `Inside this category the concentrated gap is HS ${finding.beachhead.hsCode} — ${finding.beachhead.description} — at ${formatUsd(finding.beachhead.netImports)} net imports and ${(finding.beachhead.importDependency * 100).toFixed(0)}% import dependency. A plan aimed at the category competes everywhere at once; a plan aimed at that line has a specific customer, a specific incumbent and a specific price to beat.`,
    });
  }

  if (finding.density && finding.density.saturation > 1.3) {
    strengthen.push({
      label: "Compete on tier or geography, not on availability",
      detail: `Density is a national average and is normally concentrated in one or two cities. Two things are worth checking before abandoning the idea: whether secondary cities are thin, and which tier the ${finding.density.count.toLocaleString()} existing operators serve badly. Both are cheap to establish and either one converts this from a price fight into a wedge.`,
    });
  }

  if (finding.components.feasibility < 50 && finding.playbook.route !== "distribute") {
    strengthen.push({
      label: "Cut the capital and infrastructure exposure",
      detail: `With feasibility at ${finding.components.feasibility.toFixed(0)}/100, the version of this idea that survives is the one that owns less. Lease capacity instead of buying it, contract the production stage that needs reliable power, and hold the customer relationship — which is the part that is actually scarce.`,
    });
  }

  if (finding.addressableUsd && finding.addressableUsd > 0) {
    strengthen.push({
      label: "Size the plan against the real number",
      detail: `The realistically substitutable slice here is ${formatUsd(finding.addressableUsd)} a year. 1% of it is ${formatUsd(finding.addressableUsd * 0.01)} of revenue and 5% is ${formatUsd(finding.addressableUsd * 0.05)}. If the document's projections need materially more share than that in the first years, the projections are the weak part, not the idea.`,
    });
  }

  strengthen.push({
    label: "Run the cheapest disproof first",
    detail: finding.playbook.provingTest,
  });

  killCriteria.push(
    `The landed cost of the imported equivalent comes in below what you can deliver at your realistic first-year volume. That is the whole thesis in one number, and it is knowable before you spend anything.`,
  );
  if (finding.components.feasibility < 45) {
    killCriteria.push(
      `Permitting or power turns out to add more than a few months to the ${finding.timeToRevenueMonths}-month runway. In a market this constrained, time to revenue is the binding resource.`,
    );
  }

  // ---- Summary ------------------------------------------------------------
  const summaryParts: string[] = [];
  summaryParts.push(
    `Matched to ${finding.name} in ${scan.country.name}, which ranks ${rank} of ${total} segments scored across all 16 sectors — the ${ordinal(percentile)} percentile — at ${finding.score.toFixed(1)}/100.`,
  );
  summaryParts.push(finding.playbook.headline);
  if (standing === "strong") {
    summaryParts.push(
      `The demand side holds up and the market conditions do not rule out execution. The work now is narrowing: one product line, one customer, one falsifiable test.`,
    );
  } else if (standing === "workable") {
    summaryParts.push(
      `It stands up, but not on every leg. Fix the weakest item below before treating the size figure as a plan.`,
    );
  } else if (standing === "conditional") {
    summaryParts.push(
      `There is a real gap here, but at least one thing about the market argues against entering it the way the document proposes. This is worth pursuing only if the conditions below are met — and they are all cheap to check.`,
    );
  } else {
    summaryParts.push(
      `On this evidence the idea is not supported in this market. That is not the same as a bad idea: the same concept in a market with different conditions, or a different route into this one, can score very differently. The items below say specifically what is failing.`,
    );
  }

  const matchNote =
    match.confidence >= 0.7
      ? `Matched to this segment with high confidence from the document's own vocabulary (${match.evidence.slice(0, 4).join(", ")}).`
      : match.confidence >= 0.45
        ? `Matched to this segment with moderate confidence (${match.evidence.slice(0, 4).join(", ")}). Matching is lexical, not semantic — check the alternatives below before relying on this.`
        : `Matched to this segment weakly (${match.evidence.slice(0, 4).join(", ")}), because the document's language did not clearly separate one segment from the others. Treat the verdict as provisional and pick the right segment manually if this is not it.`;

  return {
    standing,
    headline: STANDING_HEADLINE[standing],
    summary: summaryParts.join(" "),
    rank,
    totalScored: total,
    percentile,
    supports,
    againsts,
    route,
    strengthen,
    killCriteria,
    matchNote,
  };
}
