/**
 * Resolve a country's operating conditions, preferring measurement over
 * judgement — but only where a trusted dataset actually measures the thing.
 *
 * Three of the six dimensions can be derived from published indicators. Three
 * cannot, and the reason matters more than the result:
 *
 *  - Grid reliability. "Access to electricity" is published for every country
 *    and measures connections, not supply. Lebanon reads 100% while the state
 *    grid delivers a few hours a day. It is used only as a ceiling — you cannot
 *    be more reliable than you are connected — never as the value.
 *  - Informality. ILO publishes it, but coverage through the indicator API is
 *    too sparse to derive automatically.
 *  - Bureaucratic friction. Doing Business was discontinued in 2021 and its
 *    successor B-READY does not yet cover enough countries.
 *
 * Measured values are also age-gated. Lebanon's domestic credit last reported
 * in 2017 at 106% of GDP — before the banking collapse — so an ungated read
 * would report abundant financing in a country where the banking sector froze.
 * A stale measurement is worse than an honest judgement, because it arrives
 * wearing a citation.
 */

import type { SignalBundle } from "../signals/types";
import { readSignal } from "../signals/types";
import {
  NEUTRAL_CONDITIONS,
  conditionsFor,
  type Country,
  type MarketConditions,
} from "./countries";

export type ConditionProvenance =
  /** Derived this request from a published indicator. */
  | "measured"
  /** Hand-researched for this country and cited to a reference dataset. */
  | "researched"
  /** No country-specific information; a neutral prior. */
  | "default";

export type ConditionKey = Exclude<keyof MarketConditions, "notes">;

export interface ConditionField {
  key: ConditionKey;
  label: string;
  value: number;
  provenance: ConditionProvenance;
  /** Source registry id. */
  sourceId: string;
  /** How the value was arrived at, with the figures behind it. */
  basis: string;
  period?: string;
  /** True when a high value is bad, so the UI can colour it honestly. */
  inverted: boolean;
}

export interface ResolvedConditions {
  conditions: MarketConditions;
  fields: ConditionField[];
  /** True when the country has a researched overlay at all. */
  curated: boolean;
  measuredCount: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * How old an observation may be before it is refused. Four years is past the
 * World Bank's normal two-to-three year publication lag, so this rejects
 * genuinely stale series rather than merely lagging ones.
 */
const MAX_AGE_YEARS = 4;

interface Reading {
  value: number;
  year: number;
  fresh: boolean;
}

function read(bundle: SignalBundle, key: string, now: number): Reading | null {
  const signal = readSignal(bundle, key);
  if (!signal) return null;
  const year = Number(signal.period);
  if (!Number.isFinite(year)) {
    return { value: signal.value, year: now, fresh: true };
  }
  return { value: signal.value, year, fresh: now - year <= MAX_AGE_YEARS };
}

const LABELS: Record<ConditionKey, { label: string; inverted: boolean }> = {
  gridReliability: { label: "Grid reliability", inverted: false },
  currencyInstability: { label: "Currency instability", inverted: true },
  capitalScarcity: { label: "Capital scarcity", inverted: true },
  importDependence: { label: "Import dependence", inverted: true },
  bureaucraticFriction: { label: "Bureaucratic friction", inverted: true },
  informality: { label: "Informality", inverted: true },
};

export function resolveConditions(
  country: Country,
  bundle: SignalBundle,
  now: number = new Date().getUTCFullYear(),
): ResolvedConditions {
  const { conditions: base, curated } = conditionsFor(country);
  const fields: ConditionField[] = [];
  const out: MarketConditions = { ...base, notes: [...base.notes] };

  const fallback = (key: ConditionKey, reason: string): ConditionField => ({
    key,
    ...LABELS[key],
    value: base[key],
    provenance: curated ? "researched" : "default",
    sourceId: curated ? sourceForResearched(key) : "worldbank",
    basis: curated
      ? `${reason} Researched for ${country.name} and held as a constant in the country registry.`
      : `${reason} No researched value exists for ${country.name}, so this is a neutral prior of ${(NEUTRAL_CONDITIONS[key] * 100).toFixed(0)}% rather than a finding.`,
  });

  // ---- Import dependence: measured -----------------------------------------
  const imports = read(bundle, "importsShare", now);
  if (imports && imports.fresh) {
    // Imports run from roughly 10% of GDP in large closed economies to well
    // over 100% in entrepôts; 90% is taken as the point of full dependence.
    const value = clamp01(imports.value / 90);
    out.importDependence = value;
    fields.push({
      key: "importDependence",
      ...LABELS.importDependence,
      value,
      provenance: "measured",
      sourceId: "worldbank",
      period: String(imports.year),
      basis: `Imports of goods and services equal ${imports.value.toFixed(1)}% of GDP (${imports.year}), scaled against 90% as full dependence.`,
    });
  } else {
    fields.push(
      fallback(
        "importDependence",
        imports
          ? `The imports-to-GDP series for ${country.name} last reported in ${imports.year}, which is too stale to use.`
          : `No imports-to-GDP observation is published for ${country.name}.`,
      ),
    );
  }

  // ---- Currency instability: measured --------------------------------------
  const fx = readSignal(bundle, "exchangeRate.trend");
  const inflation = read(bundle, "inflation", now);
  if (fx || (inflation && inflation.fresh)) {
    // Depreciation and inflation are blended because either alone is
    // defeatable: a managed peg hides depreciation, and a subsidised basket
    // hides inflation. Both failing at once is what instability looks like.
    const depreciation = fx ? Math.max(fx.value, 0) : 0;
    const priceRise = inflation?.fresh ? Math.max(inflation.value, 0) : 0;
    const value = clamp01(
      0.55 * clamp01(depreciation / 35) + 0.45 * clamp01(priceRise / 35),
    );
    out.currencyInstability = value;
    fields.push({
      key: "currencyInstability",
      ...LABELS.currencyInstability,
      value,
      provenance: "measured",
      sourceId: "worldbank",
      period: inflation?.fresh ? String(inflation.year) : fx?.period,
      basis: `Local currency has moved ${depreciation.toFixed(1)}%/yr against the dollar over the trailing window${inflation?.fresh ? ` alongside ${inflation.value.toFixed(1)}% consumer inflation (${inflation.year})` : ""}. Both are scaled against 35%/yr as severe, then blended — a managed peg hides depreciation and a subsidised basket hides inflation, so neither is trusted alone.`,
    });
  } else {
    fields.push(
      fallback(
        "currencyInstability",
        `Neither an exchange-rate series nor recent inflation is published for ${country.name}.`,
      ),
    );
  }

  // ---- Capital scarcity: measured, age-gated -------------------------------
  const credit = read(bundle, "privateCredit", now);
  if (credit && credit.fresh) {
    const value = clamp01(1 - credit.value / 130);
    out.capitalScarcity = value;
    fields.push({
      key: "capitalScarcity",
      ...LABELS.capitalScarcity,
      value,
      provenance: "measured",
      sourceId: "worldbank",
      period: String(credit.year),
      basis: `Domestic credit to the private sector is ${credit.value.toFixed(1)}% of GDP (${credit.year}), scaled against 130% as a deep credit market.`,
    });
  } else {
    fields.push(
      fallback(
        "capitalScarcity",
        credit
          ? `Domestic credit for ${country.name} last reported in ${credit.year}, ${now - credit.year} years ago — too stale to describe today's financing conditions, and using it would understate scarcity in exactly the countries where a credit system has since failed.`
          : `No domestic-credit observation is published for ${country.name}.`,
      ),
    );
  }

  // ---- Grid reliability: researched, with a measured ceiling ---------------
  const access = read(bundle, "electricityAccess", now);
  if (access && access.fresh && access.value < base.gridReliability * 100) {
    const value = clamp01(access.value / 100);
    out.gridReliability = value;
    fields.push({
      key: "gridReliability",
      ...LABELS.gridReliability,
      value,
      provenance: "measured",
      sourceId: "worldbank",
      period: String(access.year),
      basis: `Only ${access.value.toFixed(1)}% of the population has an electricity connection (${access.year}), which caps reliability below the researched value — supply cannot be more dependable than it is available.`,
    });
  } else {
    fields.push(
      fallback(
        "gridReliability",
        `Access to electricity is published for ${country.name}${access ? ` at ${access.value.toFixed(1)}%` : ""}, but it counts connections rather than hours of supply and cannot stand in for reliability.`,
      ),
    );
  }

  // ---- Informality and bureaucratic friction: researched only --------------
  fields.push(
    fallback(
      "informality",
      "ILO publishes informal employment shares, but coverage through the indicator API is too sparse to derive a value for most countries.",
    ),
  );
  fields.push(
    fallback(
      "bureaucraticFriction",
      "Doing Business was discontinued in 2021 and its successor B-READY does not yet cover enough countries to derive this automatically.",
    ),
  );

  const order: ConditionKey[] = [
    "gridReliability",
    "currencyInstability",
    "capitalScarcity",
    "importDependence",
    "bureaucraticFriction",
    "informality",
  ];
  fields.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  return {
    conditions: out,
    fields,
    curated,
    measuredCount: fields.filter((f) => f.provenance === "measured").length,
  };
}

function sourceForResearched(key: ConditionKey): string {
  switch (key) {
    case "gridReliability":
      return "enterpriseSurveys";
    case "informality":
      return "ilostat";
    case "bureaucraticFriction":
      return "bReady";
    case "currencyInstability":
      return "imfWeo";
    default:
      return "worldbank";
  }
}
