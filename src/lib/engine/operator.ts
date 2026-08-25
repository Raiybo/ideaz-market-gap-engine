/**
 * Fitting a measured gap to the person who might actually enter it.
 *
 * The scoring engine and the playbook both answer a question about the
 * *country*: given this market's grid, credit and informality, what is the
 * binding constraint and therefore the way in? That is the right question, and
 * it is only half of one. "Make it here" is the correct route for Lebanon and
 * useless advice for someone with eighty thousand dollars and no factory.
 *
 * This module takes the route the engine chose and re-derives it against what
 * the operator can actually do. It never invents a new opportunity and never
 * changes a measured figure — the import bill is what it is. It changes which
 * of the seven existing routes is reachable, and says plainly which answer
 * moved it, so a recommendation can be argued with rather than just accepted.
 *
 * A blocked verdict is a real output, not a failure. Telling someone their
 * capital cannot reach a gap is worth more than routing them into it anyway.
 */

import type { MarketConditions } from "../domain/countries";
import type { Segment } from "../domain/sectors";
import {
  capitalFor,
  ROUTE_NAMES,
  type CapitalBand,
  type EntryRouteId,
  type Playbook,
} from "./playbook";
import { formatUsd } from "./score";

export type CapitalBandId = "under-50k" | "50k-250k" | "250k-1m" | "over-1m";
export type BuildCapability =
  | "distribute"
  | "assemble"
  | "manufacture"
  | "software";
export type Horizon = "6mo" | "2yr" | "3yr-plus";
export type TeamShape = "solo" | "commercial" | "engineering" | "hardware-ops";
export type RegulatoryAppetite = "avoid" | "permits" | "controlled";

export interface OperatorProfile {
  capital: CapitalBandId;
  build: BuildCapability;
  horizon: Horizon;
  team: TeamShape;
  regulatory: RegulatoryAppetite;
}

export type FitVerdict = "fits" | "stretch" | "blocked";

export interface OperatorFit {
  verdict: FitVerdict;
  route: EntryRouteId;
  routeName: string;
  defaultRoute: EntryRouteId;
  defaultRouteName: string;
  routeChanged: boolean;
  /** Why this route, phrased against the answers that decided it. */
  reasons: string[];
  /** Mismatches that stop this working at all. */
  blockers: string[];
  /** Real but survivable friction. */
  strains: string[];
  capital: CapitalBand;
  capitalShortfallUsd: number | null;
  monthsOverHorizon: number | null;
}

/** The most an operator in each band can put in. */
const CAPITAL_CEILING: Record<CapitalBandId, number> = {
  "under-50k": 50_000,
  "50k-250k": 250_000,
  "250k-1m": 1_000_000,
  "over-1m": 40_000_000,
};

const CAPITAL_LABEL: Record<CapitalBandId, string> = {
  "under-50k": "under $50K",
  "50k-250k": "$50K–$250K",
  "250k-1m": "$250K–$1M",
  "over-1m": "$1M+",
};

const HORIZON_MONTHS: Record<Horizon, number> = {
  "6mo": 6,
  "2yr": 24,
  "3yr-plus": 60,
};

const HORIZON_LABEL: Record<Horizon, string> = {
  "6mo": "revenue inside 6 months",
  "2yr": "revenue within 2 years",
  "3yr-plus": "a 3-year-plus horizon",
};

/**
 * Routes ordered by how much production they require you to own. Stepping down
 * this ladder is how a capital or capability constraint gets resolved: the gap
 * does not move, the position you take against it does.
 */
const OWNERSHIP_LADDER: EntryRouteId[] = [
  "substitute",
  "finish-local",
  "distribute",
];

function stepDown(route: EntryRouteId): EntryRouteId | null {
  const i = OWNERSHIP_LADDER.indexOf(route);
  if (i === -1 || i === OWNERSHIP_LADDER.length - 1) return null;
  return OWNERSHIP_LADDER[i + 1];
}

export interface FitInput {
  playbook: Playbook;
  segment: Segment;
  conditions: MarketConditions;
  profile: OperatorProfile;
  /** True when the segment carries a customs footprint. */
  physical: boolean;
}

export function fitOperator(input: FitInput): OperatorFit {
  const { playbook, segment, conditions, profile, physical } = input;
  const defaultRoute = playbook.route;

  let route = defaultRoute;
  const reasons: string[] = [];
  const blockers: string[] = [];
  const strains: string[] = [];

  // 1. Capability. What you can build decides which positions exist for you,
  //    before money is even discussed.
  if (profile.build === "distribute" && OWNERSHIP_LADDER.includes(route)) {
    if (route !== "distribute") {
      reasons.push(
        `You said you can sell and distribute but not produce, so "${ROUTE_NAMES[route]}" is not a position you can take. Owning the channel is — and against an import bill this size, the channel is where the margin already sits.`,
      );
      route = "distribute";
    }
  }

  if (profile.build === "software") {
    if (physical) {
      blockers.push(
        `This is a physical-goods gap measured in customs data, and you said you build software. Nothing here is closed by writing code — the margin is in making or moving the goods.`,
      );
    } else if (route !== "service") {
      reasons.push(
        `The gap has no customs footprint and you build software, so the way in is the service itself rather than any trade position.`,
      );
      route = "service";
    }
  }

  if (profile.build === "assemble" && route === "substitute") {
    reasons.push(
      `You said you can assemble rather than manufacture end to end, so this drops from full local production to importing bulk and finishing here — the same customer, a fraction of the plant.`,
    );
    route = "finish-local";
  }

  // 2. Regulation. A gap can be entirely real and still be closed to you.
  if (profile.regulatory === "avoid" && segment.regulatoryBurden > 0.6) {
    blockers.push(
      `This segment carries a regulatory burden of ${(segment.regulatoryBurden * 100).toFixed(0)}% on the structural model — licensing, inspection or end-use control — and you said you want to avoid licensed sectors.`,
    );
  } else if (
    profile.regulatory === "permits" &&
    segment.regulatoryBurden > 0.85
  ) {
    blockers.push(
      `At ${(segment.regulatoryBurden * 100).toFixed(0)}% regulatory burden this is national-licence and export-control territory, not the permit-and-inspection level you said you were willing to take on.`,
    );
  }

  // 3. Capital. Step down the ownership ladder until the band is reachable,
  //    then report the shortfall if even the cheapest position is out of range.
  const ceiling = CAPITAL_CEILING[profile.capital];
  let capital = capitalFor(segment, route, conditions);
  let shortfall: number | null = null;

  while (capital.low > ceiling) {
    const cheaper = stepDown(route);
    if (!cheaper) break;
    reasons.push(
      `"${ROUTE_NAMES[route]}" starts around ${formatUsd(capital.low)} and you have ${CAPITAL_LABEL[profile.capital]}, so it steps down to "${ROUTE_NAMES[cheaper]}".`,
    );
    route = cheaper;
    capital = capitalFor(segment, route, conditions);
  }

  if (capital.low > ceiling) {
    shortfall = capital.low - ceiling;
    blockers.push(
      `Even the least capital-hungry position here starts around ${formatUsd(capital.low)}, and you have ${CAPITAL_LABEL[profile.capital]}. The shortfall is roughly ${formatUsd(shortfall)}.`,
    );
  }

  // 4. Time. Distribution reaches revenue fastest because nothing is built.
  const horizonMonths = HORIZON_MONTHS[profile.horizon];
  const months =
    route === "distribute"
      ? Math.round(segment.timeToRevenueMonths * 0.5)
      : segment.timeToRevenueMonths;
  let monthsOver: number | null = null;

  if (months > horizonMonths) {
    monthsOver = months - horizonMonths;
    const cheaper = stepDown(route);
    if (cheaper && !blockers.length) {
      reasons.push(
        `At ${months} months to first revenue this misses ${HORIZON_LABEL[profile.horizon]} by ${monthsOver}. Stepping to "${ROUTE_NAMES[cheaper]}" trades margin for speed.`,
      );
      route = cheaper;
      capital = capitalFor(segment, route, conditions);
      const faster = Math.round(segment.timeToRevenueMonths * 0.5);
      monthsOver = faster > horizonMonths ? faster - horizonMonths : null;
    } else {
      strains.push(
        `First revenue is ${months} months out and you wanted ${HORIZON_LABEL[profile.horizon]} — ${monthsOver} months short. Everything else can fit and this still will not.`,
      );
    }
  }

  // 5. Team. Never blocking on its own; it is the thing you can most easily fix.
  if (profile.team === "solo" && segment.laborIntensity > 0.7) {
    strains.push(
      `This segment is people-heavy (${(segment.laborIntensity * 100).toFixed(0)}% labour intensity) and you are working alone. The first hire is the constraint, not the capital.`,
    );
  }
  if (profile.team === "commercial" && route === "substitute") {
    strains.push(
      `Local production needs production people. A commercial team can sell this before it can make it — which is an argument for starting on the channel and integrating backwards.`,
    );
  }
  if (
    profile.team === "engineering" &&
    physical &&
    segment.infrastructureDependency > 0.75
  ) {
    strains.push(
      `Infrastructure dependency here is ${(segment.infrastructureDependency * 100).toFixed(0)}% — power, port or cold chain. An engineering team does not substitute for a grid.`,
    );
  }

  if (route === defaultRoute && !reasons.length) {
    reasons.push(
      `Your answers do not change the route: "${ROUTE_NAMES[route]}" is what the market's own constraints already pointed to, and nothing you said rules it out.`,
    );
  }

  const verdict: FitVerdict = blockers.length
    ? "blocked"
    : strains.length
      ? "stretch"
      : "fits";

  return {
    verdict,
    route,
    routeName: ROUTE_NAMES[route],
    defaultRoute,
    defaultRouteName: ROUTE_NAMES[defaultRoute],
    routeChanged: route !== defaultRoute,
    reasons,
    blockers,
    strains,
    capital,
    capitalShortfallUsd: shortfall,
    monthsOverHorizon: monthsOver,
  };
}
