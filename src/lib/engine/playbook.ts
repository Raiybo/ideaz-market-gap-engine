/**
 * From gap to business.
 *
 * The scoring engine answers "where is demand not being met". That is only half
 * an answer: a $265M import bill is not an opportunity until someone can name a
 * way to take a slice of it. This module turns each scored segment into a
 * concrete entry route, sized in money and time.
 *
 * The hard rule here is that nothing is invented. Every sentence is composed
 * from figures the engine already observed — the import bill, the dependency
 * ratio, the trajectory, mapped premise density, the country's own capital and
 * grid conditions — or from the segment's curated structural economics, which
 * are labelled as such. Where a number would have to be guessed (margins,
 * salaries, land costs) it is not stated at all; instead the arithmetic is
 * shown against the observed figure so the reader can apply their own.
 */

import type { MarketConditions } from "../domain/countries";
import type { Sector, Segment } from "../domain/sectors";
import { formatUsd, type Opportunity } from "./score";

/**
 * How you get in. Chosen from the data, not from a menu — the same segment in
 * two countries routinely resolves to different routes because the binding
 * constraint differs.
 */
export type EntryRouteId =
  | "substitute"
  | "finish-local"
  | "distribute"
  | "export"
  | "service"
  | "formalise"
  | "differentiate";

export interface CapitalBand {
  label: string;
  low: number;
  high: number;
  rationale: string;
}

export interface Playbook {
  route: EntryRouteId;
  /** Name of the route as shown to the reader. */
  routeName: string;
  /** One line: what was found, in plain language. */
  headline: string;
  /** Two to four sentences explaining the finding and why it is a gap. */
  finding: string;
  /** Why money can be made here, and roughly how much per point of share. */
  thesis: string;
  /** The arithmetic of capture, against the observed addressable figure. */
  revenueMath: string[];
  /** Concrete opening moves, in order, for roughly the first 90 days. */
  firstMoves: string[];
  /** The cheapest experiment that would prove this wrong before committing. */
  provingTest: string;
  /** Who pays, specifically. */
  buyers: string[];
  /** What realistically kills it. Merged with the scorer's own risks. */
  killers: string[];
  capital: CapitalBand;
  /** Months to first revenue, carried from the segment model. */
  timeToRevenueMonths: number;
  /** Set when the gap is measured rather than modelled. */
  observed: boolean;
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/**
 * Capital bands are expressed as ranges an order of magnitude wide because
 * that is the honest precision available without local quotes. The band is
 * derived from the segment's capital intensity and then shifted down for routes
 * that deliberately avoid owning production.
 */
const BANDS: Array<{ ceiling: number; label: string; low: number; high: number }> = [
  { ceiling: 0.25, label: "Under $50K", low: 5_000, high: 50_000 },
  { ceiling: 0.45, label: "$50K – $250K", low: 50_000, high: 250_000 },
  { ceiling: 0.65, label: "$250K – $1.5M", low: 250_000, high: 1_500_000 },
  { ceiling: 0.8, label: "$1.5M – $8M", low: 1_500_000, high: 8_000_000 },
  { ceiling: 1.1, label: "$8M+", low: 8_000_000, high: 40_000_000 },
];

export function capitalFor(
  segment: Segment,
  route: EntryRouteId,
  conditions: MarketConditions,
): CapitalBand {
  const assetLight =
    route === "distribute" || route === "finish-local" || route === "formalise";
  const intensity = assetLight
    ? Math.max(0, segment.capitalIntensity - 0.25)
    : segment.capitalIntensity;

  const index = BANDS.findIndex((b) => intensity <= b.ceiling);
  const band = BANDS[index === -1 ? BANDS.length - 1 : index];

  const parts: string[] = [];
  if (assetLight) {
    parts.push(
      `This route deliberately avoids owning production, which is why the band sits below the ${pct(segment.capitalIntensity)} capital intensity the segment normally carries.`,
    );
  } else {
    parts.push(
      `Segment capital intensity is ${pct(segment.capitalIntensity)} on the structural model.`,
    );
  }
  if (conditions.capitalScarcity > 0.6) {
    parts.push(
      `Local financing is scarce (${pct(conditions.capitalScarcity)}), so assume this is equity, diaspora or self-funded rather than bank debt.`,
    );
  }
  return { ...band, rationale: parts.join(" ") };
}

interface RouteInput {
  opportunity: Opportunity;
  segment: Segment;
  sector: Sector;
  conditions: MarketConditions;
  countryName: string;
  gdpPerCapita: number;
}

/**
 * Route selection. Ordered by how binding the constraint is: a saturated market
 * overrides everything (there is no gap to walk into), then physical
 * impossibility, then capital, then the ordinary substitution case.
 */
function chooseRoute(input: RouteInput): EntryRouteId {
  const { opportunity: o, segment, conditions } = input;
  const gap = o.tradeGap;
  const observed = Boolean(gap?.observed && gap.imports > 0);

  if (o.density && o.density.saturation > 1.4) return "differentiate";

  if (!observed) {
    if (conditions.informality > 0.6 && !segment.b2b) return "formalise";
    return "service";
  }

  const netExporter = gap!.exports > gap!.imports;
  if (netExporter || segment.id.includes("export")) return "export";

  const cannotMake =
    segment.importSubstitutability < 0.55 ||
    segment.infrastructureDependency * (1 - conditions.gridReliability) > 0.55;
  if (cannotMake) return "distribute";

  const capitalBlocked =
    segment.capitalIntensity * conditions.capitalScarcity > 0.42;
  if (capitalBlocked) return "finish-local";

  return "substitute";
}

export const ROUTE_NAMES: Record<EntryRouteId, string> = {
  substitute: "Make it here",
  "finish-local": "Import bulk, finish locally",
  distribute: "Own the channel",
  export: "Sell it outward",
  service: "Build the missing service",
  formalise: "Aggregate what is already there",
  differentiate: "Enter on a wedge",
};

function revenueMath(o: Opportunity): string[] {
  const addressable = o.addressableUsd;
  if (!addressable || addressable <= 0) return [];
  const observed = Boolean(o.tradeGap?.observed);
  const basis = observed
    ? "of the realistically substitutable slice of the import bill"
    : "of the modelled unserved pool";

  return [1, 5, 10].map(
    (share) =>
      `${share}% ${basis} is ${formatUsd(addressable * (share / 100))} of annual revenue.`,
  );
}

function buildFinding(input: RouteInput): { headline: string; finding: string } {
  const { opportunity: o, countryName, segment } = input;
  const gap = o.tradeGap;

  if (gap?.observed && gap.imports > 0) {
    const dep = pct(gap.importDependency);
    const sentences = [
      `${countryName} imported ${formatUsd(gap.imports)} of ${segment.name.toLowerCase()} in ${gap.year} and exported ${formatUsd(gap.exports)}, meaning ${dep} of what the country consumes in this category is made somewhere else.`,
      gap.netImports > 0
        ? `Net ${formatUsd(gap.netImports)} leaves the country every year to pay for it.`
        : `Net ${formatUsd(-gap.netImports)} more goes out as exports than comes in, so on balance the country supplies this category rather than buying it.`,
    ];

    if (gap.trendPct !== null && gap.trendBaseYear) {
      sentences.push(
        gap.trendPct > 0
          ? `That outflow has grown ${gap.trendPct.toFixed(1)}% a year since ${gap.trendBaseYear}, so domestic supply is falling further behind rather than catching up.`
          : `That outflow has shrunk ${Math.abs(gap.trendPct).toFixed(1)}% a year since ${gap.trendBaseYear}, which means capacity is already being built here — you would be entering against someone mid-build.`,
      );
    }

    if (o.density) {
      sentences.push(
        o.density.saturation > 1.2
          ? `On the ground the category is already ${o.density.saturation.toFixed(2)}x more densely served than typical, so availability is not the missing piece.`
          : `Only ${o.density.count.toLocaleString()} ${o.density.label} are mapped in the country — ${o.density.saturation.toFixed(2)}x typical density, so the supply side is genuinely thin.`,
      );
    }

    return {
      headline:
        gap.netImports > 0
          ? `${formatUsd(gap.netImports)} a year leaves ${countryName} for ${segment.name.toLowerCase()} — ${dep} of the category is imported.`
          : `${countryName} is a net supplier of ${segment.name.toLowerCase()} — ${formatUsd(-gap.netImports)} a year more goes out than comes in, though ${dep} of what it consumes is still imported.`,
      finding: sentences.join(" "),
    };
  }

  const structural = o.evidence.find((e) => e.label === "Structural deficit");
  const split = o.evidence.find((e) => e.label === "Segment share of the sector");
  const pool = o.addressableUsd ? formatUsd(o.addressableUsd) : "an unsized pool";
  return {
    headline: `${segment.name} in ${countryName} shows an unserved pool near ${pool}, inferred from structural indicators rather than customs data.`,
    finding: [
      structural?.detail ?? "",
      split?.detail ?? "",
      `This segment has no customs footprint, so the gap is modelled from macro indicators instead of measured directly. Treat the size as directional and verify locally before committing capital.`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/** Route-specific play: thesis, opening moves, the falsification test, buyers. */
function buildRoute(
  route: EntryRouteId,
  input: RouteInput,
): Pick<Playbook, "thesis" | "firstMoves" | "provingTest" | "buyers"> {
  const { opportunity: o, segment, conditions, countryName } = input;
  const gap = o.tradeGap;
  const netImports = gap?.observed ? gap.netImports : 0;

  switch (route) {
    case "substitute":
      return {
        thesis: `Every unit produced here displaces an imported one at a landed cost that already includes freight, duty and an importer's margin. That stack is your headroom: you are not competing on being better, only on being closer. With ${pct(segment.importSubstitutability)} of the category realistically producible locally, ${formatUsd(o.addressableUsd ?? 0)} of the ${formatUsd(netImports)} outflow is genuinely contestable.`,
        firstMoves: [
          `Pull the 6-digit customs lines for this category and pick the single largest one — enter one product, not a category. The drill-down on this card gives you that list ranked.`,
          `Price the imported equivalent at retail and at wholesale in ${countryName}, then work backwards to landed cost. The gap between landed cost and your producible cost is the entire business.`,
          `Identify the three largest current importers of that line. They are your competition, but they are also your most likely first customers if you can supply cheaper than they can land it.`,
          `Secure input supply before equipment. In an import-substitution play the failure mode is almost always an input you also have to import.`,
          `Run a pilot batch on rented or third-party capacity before buying a plant.`,
        ],
        provingTest: `Get a written quote for the imported product at wholesale volume, and a costed quote for producing the same specification locally. If local cost is not below landed cost at a volume you can actually reach in year one, the thesis is dead and you have spent nothing.`,
        buyers: segment.b2b
          ? ["Wholesalers and distributors currently importing the line", "Manufacturers using it as an input", "Retail chains seeking a local-supply story"]
          : ["Retail chains and independent grocers", "Direct-to-consumer where the imported brand is priced at a premium", "Institutional buyers — hotels, hospitals, catering"],
      };

    case "finish-local":
      return {
        thesis: `The full plant is out of reach in a market where financing scores ${pct(conditions.capitalScarcity)} scarce, but you do not need the full plant. The last stage of production — packing, blending, assembly, labelling, finishing — carries a disproportionate share of the value and a fraction of the capital. Import the bulk input, capture the final margin, and you are inside the ${formatUsd(netImports)} flow without financing an industrial build.`,
        firstMoves: [
          `Split the category into "bulk input" and "finished good" and compare the two customs lines. The spread between them is the margin this route is targeting.`,
          `Find a bulk supplier who currently sells finished product into ${countryName} — many will sell you the input instead, since it is volume either way.`,
          `Lease finishing capacity rather than building it. Contract packers exist in most markets and their idle time is cheap.`,
          `Design the local element deliberately: local labelling, local format, local shelf-size. That is what makes the finished good genuinely yours rather than a repackaged import.`,
        ],
        provingTest: `Buy one container of bulk input, finish it on contracted capacity, and sell it. This is a five-figure test of a seven-figure thesis, and it answers the only question that matters — whether the finished margin survives contact with real pricing.`,
        buyers: ["Existing distributors of the imported finished good", "Retail buyers who want a local SKU", "Institutional and HORECA buyers who buy on price per unit"],
      };

    case "distribute":
      return {
        thesis: `Local production is not realistic here — ${segment.importSubstitutability < 0.55 ? `only ${pct(segment.importSubstitutability)} of this category can be made locally at all` : `the infrastructure this segment needs does not exist reliably at ${pct(conditions.gridReliability)} grid reliability`}. That does not close the opportunity, it relocates it. ${formatUsd(netImports)} a year is already flowing in; whoever controls how it reaches the end customer takes a margin on all of it without producing anything.`,
        firstMoves: [
          `Map the existing chain for this category: who imports, who wholesales, who retails, and what margin each takes. In fragmented markets there are usually two intermediaries that add cost and no service.`,
          `Approach manufacturers abroad for an exclusive or semi-exclusive territory. Small markets are routinely under-served by large producers because no one has asked.`,
          `Compete on service, not price: stock availability, credit terms, delivery frequency, technical support. These are what fragmented importers do badly.`,
          `Start with one product line and one customer segment, then widen the catalogue once the logistics work.`,
        ],
        provingTest: `Sign one supply agreement and one anchor customer before renting a warehouse. If you cannot get either on paper, the chain is not as open as the trade data suggests.`,
        buyers: ["Retailers and wholesalers currently buying through intermediaries", "End-user businesses buying in volume", "Project and tender buyers needing guaranteed supply"],
      };

    case "export":
      return {
        thesis: `This category already has a domestic production base — that is why exports are ${formatUsd(gap?.exports ?? 0)} against imports of ${formatUsd(gap?.imports ?? 0)}. The opportunity is not to build supply but to reach demand: aggregating, branding and selling outward.${conditions.currencyInstability > 0.5 ? ` With currency instability at ${pct(conditions.currencyInstability)}, earning in hard currency against a local cost base is itself the margin.` : ""}`,
        firstMoves: [
          `Identify the producers already exporting and the far larger number who are not because they cannot meet certification, packaging or volume requirements alone.`,
          `Pick one destination market and satisfy its entry requirements properly — labelling, certification, phytosanitary or standards compliance. That paperwork is the actual moat.`,
          `Aggregate supply under one brand and one quality standard. Individually the producers are too small; together they are a shipment.`,
          `Sell into diaspora and specialty channels first — they accept origin as the value proposition and forgive scale.`,
        ],
        provingTest: `Ship one consolidated pallet to one buyer in one destination market and get paid. Everything else — certification, branding, volume — follows from having done it once.`,
        buyers: ["Specialty importers and distributors abroad", "Diaspora retail channels", "Private-label buyers for foreign retail chains"],
      };

    case "service": {
      const structural = o.evidence.find((e) => e.label === "Structural deficit");
      return {
        thesis: `${structural?.detail ?? "Structural indicators point to demand well ahead of local provision."} Services do not appear in customs data, which is precisely why gaps here stay open longer than in goods — nobody is measuring them. Capital intensity is ${pct(segment.capitalIntensity)}, so the constraint is execution and trust rather than financing.`,
        firstMoves: [
          `Find the ten customers who feel this gap most acutely and sell to them by hand before building anything. In services the first ten customers are the product spec.`,
          `Deliver the service manually before automating it. Whatever survives contact with real customers is what deserves software.`,
          `Price against the cost of the current workaround, not against competitors — in an underserved market the alternative is usually "does it badly in-house".`,
          `Build the reference case deliberately. In ${countryName}, ${conditions.informality > 0.6 ? "where most business runs on relationships rather than procurement" : "where formal procurement dominates"}, a named reference customer opens more doors than any marketing spend.`,
        ],
        provingTest: `Sell it before it exists: take payment or a signed letter of intent from three customers on the basis of a description alone. If nobody will commit on paper, the deficit the indicators show is not felt as a problem worth paying for.`,
        buyers: segment.b2b
          ? ["Businesses currently handling this in-house at higher cost", "Sector-specific mid-market firms", "Public and donor-funded programmes where applicable"]
          : ["Urban households in the income bracket the indicators identify", "Employers buying it as a benefit", "Institutions serving the affected population"],
      };
    }

    case "formalise":
      return {
        thesis: `${pct(conditions.informality)} of commerce in ${countryName} runs informally. That is not an absence of activity, it is activity without infrastructure — no invoicing, no credit history, no reliable supply, no standards. Aggregating fragmented informal supply into something with terms and consistency is a durable position, because the incumbent competition cannot follow you into the formal sector without changing what it is.`,
        firstMoves: [
          `Count the informal operators in one city and one category. The size of the fragmentation is the size of the prize.`,
          `Solve one thing they cannot solve alone: bulk purchasing, guaranteed offtake, working capital, or a standard the end buyer trusts.`,
          `Formalise gradually — start as their customer or supplier rather than their regulator. Trust precedes paperwork here.`,
          `Sell the aggregated output to buyers who can only buy formally: chains, institutions, exporters.`,
        ],
        provingTest: `Aggregate supply from five informal operators and fulfil one order for a formal buyer who could not previously buy from them. That single transaction tests supply reliability, quality consistency and buyer appetite at once.`,
        buyers: ["Formal retail chains that cannot buy from informal suppliers", "Institutional and corporate buyers with procurement requirements", "Exporters needing traceable supply"],
      };

    case "differentiate":
      return {
        thesis: `The trade data shows a gap, but the ground does not: ${o.density?.count.toLocaleString()} ${o.density?.label} are mapped here, ${o.density?.saturation.toFixed(2)}x typical density. Entering on availability alone would put you in a price fight with incumbents who are already paid for. The money in a served market is in the segment everyone serves badly — the premium tier, the underserved geography, or the customer type the format was never designed for.`,
        firstMoves: [
          `Visit fifteen existing operators as a customer and write down what all of them do badly. The common failure is the wedge.`,
          `Pick the tier, not the category: the same product at a quality or convenience level the incumbents cannot reach without abandoning their cost base.`,
          `Check the geography — density is a national average, and it is routinely concentrated in one or two cities while secondary markets stay thin.`,
          `Compete on a dimension incumbents cannot copy quickly: supply chain, format, hours, reliability, or a genuinely different product.`,
        ],
        provingTest: `Run the differentiated version at the smallest possible scale — one location, one pop-up, one route — and measure whether customers pay the premium. Saturated markets punish assumptions faster than anything else, and they do it cheaply if you keep the test small.`,
        buyers: ["The premium tier the incumbents underserve", "Customers in geographies outside the dense core", "Business customers needing reliability the fragmented incumbents cannot offer"],
      };
  }
}

export function buildPlaybook(input: RouteInput): Playbook {
  const { opportunity: o, segment, conditions } = input;
  const route = chooseRoute(input);
  const { headline, finding } = buildFinding(input);
  const { thesis, firstMoves, provingTest, buyers } = buildRoute(route, input);

  const killers = [...o.risks];
  if (route === "substitute" && conditions.currencyInstability > 0.6) {
    killers.push(
      `A devaluation that outruns your pricing wipes out the landed-cost advantage overnight if any of your inputs are imported. Price in the same currency your inputs are bought in wherever the market allows it.`,
    );
  }
  if (route === "distribute") {
    killers.push(
      `Distribution margins are contractual, not structural: the manufacturer that grants you a territory can take it back, and will once the volume is proven. Build customer relationships that survive losing the agency.`,
    );
  }
  if (route === "differentiate") {
    killers.push(
      `In a market at ${o.density?.saturation.toFixed(2)}x typical density, an incumbent can copy a format faster than you can scale it. The wedge has to be something they would have to break their own cost structure to match.`,
    );
  }

  return {
    route,
    routeName: ROUTE_NAMES[route],
    headline,
    finding,
    thesis,
    revenueMath: revenueMath(o),
    firstMoves,
    provingTest,
    buyers,
    killers,
    capital: capitalFor(segment, route, conditions),
    timeToRevenueMonths: segment.timeToRevenueMonths,
    observed: Boolean(o.tradeGap?.observed),
  };
}
