"use client";

/**
 * Saved findings, held in the browser.
 *
 * Two things this makes possible that a stateless page cannot. A finding you
 * decided to think about survives closing the tab. And because each save
 * records the score at the time, the next scan can show which way it moved —
 * which is the only way this system can tell you a gap is closing while you
 * were deciding, as opposed to telling you it was closing three years ago.
 *
 * Deliberately client-side. A server-side store would mean accounts, a
 * database and a privacy surface, to hold a list of segment ids the user could
 * otherwise keep in a text file.
 */

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "ideaz.watchlist.v1";
const MAX_ENTRIES = 60;

export interface WatchEntry {
  segmentId: string;
  countryIso3: string;
  countryName: string;
  segmentName: string;
  sectorName: string;
  /** Score at the moment it was saved. */
  score: number;
  /** Net imports or modelled pool at the moment it was saved, USD. */
  addressableUsd: number | null;
  savedAt: string;
}

export interface WatchDelta {
  entry: WatchEntry;
  /** Current minus saved. Null when the segment is not in the current scan. */
  scoreChange: number | null;
  daysHeld: number;
}

function read(): WatchEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WatchEntry[]) : [];
  } catch {
    // A corrupted or quota-blocked store must not take the page down.
    return [];
  }
}

/**
 * Subscribers are notified on every write so several cards showing the same
 * segment stay in agreement without prop-drilling the list through the page.
 */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(entries: WatchEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_ENTRIES)),
    );
  } catch {
    // Private browsing and full quotas both throw here; saving is a
    // convenience, not a guarantee.
  }
  notify();
}

const keyOf = (countryIso3: string, segmentId: string) =>
  `${countryIso3}:${segmentId}`;

export function listWatched(): WatchEntry[] {
  return read().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function isWatched(countryIso3: string, segmentId: string): boolean {
  return read().some(
    (e) => keyOf(e.countryIso3, e.segmentId) === keyOf(countryIso3, segmentId),
  );
}

/** Adds if absent, removes if present. Returns the new watched state. */
export function toggleWatch(entry: Omit<WatchEntry, "savedAt">): boolean {
  const entries = read();
  const key = keyOf(entry.countryIso3, entry.segmentId);
  const existing = entries.findIndex(
    (e) => keyOf(e.countryIso3, e.segmentId) === key,
  );

  if (existing >= 0) {
    entries.splice(existing, 1);
    write(entries);
    return false;
  }

  // The saved score is a snapshot, never refreshed — refreshing it in place
  // would erase exactly the movement the entry exists to reveal.
  entries.unshift({ ...entry, savedAt: new Date().toISOString() });
  write(entries);
  return true;
}

export function clearWatchlist(): void {
  write([]);
}

/**
 * Read watched state without a mount effect.
 *
 * localStorage does not exist while the page is rendered on the server, so the
 * server snapshot is always `false` and the client corrects it on hydration —
 * which is exactly what useSyncExternalStore is for, and avoids the
 * setState-in-effect that a mount effect would need.
 */
export function useIsWatched(countryIso3: string, segmentId: string): boolean {
  const getSnapshot = useCallback(
    () => isWatched(countryIso3, segmentId),
    [countryIso3, segmentId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** The saved list, kept in sync across every component that shows it. */
export function useWatchlist(): WatchEntry[] {
  return useSyncExternalStore(subscribe, cachedList, emptyList);
}

// useSyncExternalStore compares snapshots by identity, so a fresh array on
// every read would loop forever. The list is re-derived only when a write
// happens.
let cache: WatchEntry[] | null = null;
const EMPTY: WatchEntry[] = [];
const emptyList = () => EMPTY;

function cachedList(): WatchEntry[] {
  if (cache === null) cache = listWatched();
  return cache;
}

listeners.add(() => {
  cache = null;
});

/**
 * Compare saved snapshots against a current scan. Entries for other countries
 * are returned with a null change rather than dropped — the list is the user's,
 * not the current view's.
 */
export function deltasFor(
  current: Array<{ segmentId: string; score: number }>,
  countryIso3: string,
): WatchDelta[] {
  const byId = new Map(current.map((f) => [f.segmentId, f.score]));
  const now = Date.now();

  return listWatched().map((entry) => {
    const live =
      entry.countryIso3 === countryIso3 ? byId.get(entry.segmentId) : undefined;
    const saved = new Date(entry.savedAt).getTime();
    return {
      entry,
      scoreChange:
        live === undefined ? null : Math.round((live - entry.score) * 10) / 10,
      daysHeld: Math.max(0, Math.floor((now - saved) / 86400000)),
    };
  });
}
