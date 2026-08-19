/**
 * Signal layer contracts.
 *
 * Every number that reaches the scoring engine arrives as a Signal carrying its
 * own provenance. This is deliberate: the difference between "Lebanon imported
 * $412M of dairy in 2023" and "we assumed dairy is ~4% of food spend" is the
 * difference between a finding and a guess, and the UI must be able to tell the
 * user which one it is showing them.
 */

export type SignalProvenance =
  /** Fetched from a live external dataset this request. */
  | "live"
  /** Live source was unavailable; last known good value from cache. */
  | "cached"
  /** Hand-researched constant in the repo. */
  | "curated"
  /** Derived from other signals by an explicit model, not observed. */
  | "modelled";

export interface Signal {
  /** Stable key, e.g. "population" or "imports.dairy". */
  key: string;
  value: number;
  unit: string;
  provenance: SignalProvenance;
  /** Human-readable source, shown in the UI. */
  source: string;
  /** Year or period the observation refers to. */
  period?: string;
  /** 0..1 — how much weight the engine should place on this observation. */
  confidence: number;
}

export interface SignalBundle {
  countryIso3: string;
  signals: Map<string, Signal>;
  /** Non-fatal problems worth surfacing (API down, no data for country, etc). */
  warnings: string[];
}

export function makeBundle(countryIso3: string): SignalBundle {
  return { countryIso3, signals: new Map(), warnings: [] };
}

export function put(bundle: SignalBundle, signal: Signal): void {
  const existing = bundle.signals.get(signal.key);
  // Prefer higher-confidence observations when two sources collide.
  if (!existing || signal.confidence > existing.confidence) {
    bundle.signals.set(signal.key, signal);
  }
}

export function read(
  bundle: SignalBundle,
  key: string,
  fallback: number,
): number {
  const s = bundle.signals.get(key);
  return s ? s.value : fallback;
}

export function readSignal(
  bundle: SignalBundle,
  key: string,
): Signal | undefined {
  return bundle.signals.get(key);
}

/**
 * Mean confidence across the keys that actually drove a score. Used to tell the
 * user how much to trust an opportunity rather than presenting all of them as
 * equally certain.
 */
export function confidenceOver(
  bundle: SignalBundle,
  keys: string[],
): number {
  const found = keys
    .map((k) => bundle.signals.get(k))
    .filter((s): s is Signal => Boolean(s));
  if (found.length === 0) return 0.2;
  const mean =
    found.reduce((acc, s) => acc + s.confidence, 0) / found.length;
  // Penalise bundles that are missing requested keys outright.
  const coverage = found.length / keys.length;
  return Math.max(0.05, Math.min(1, mean * (0.5 + 0.5 * coverage)));
}
