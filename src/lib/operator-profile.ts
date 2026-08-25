"use client";

/**
 * The operator's own constraints, held in the browser.
 *
 * Answered once and reused across every finding, because the alternative is
 * asking the same five questions on each of thirteen cards. Kept client-side
 * for the same reason the watchlist is: this is five enum values, and putting
 * them on a server would mean accounts and a privacy surface to hold something
 * the user could write on a napkin.
 */

import { useSyncExternalStore } from "react";

import type { OperatorProfile } from "./engine/operator";

const STORAGE_KEY = "ideaz.operator.v1";

export type PartialProfile = Partial<OperatorProfile>;

function read(): PartialProfile {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as PartialProfile)
      : {};
  } catch {
    // A corrupted or quota-blocked store must not take the page down.
    return {};
  }
}

const listeners = new Set<() => void>();

/**
 * Cached so getSnapshot returns a stable reference between writes.
 * useSyncExternalStore compares by identity and would loop forever on a fresh
 * object each call.
 */
let cache: PartialProfile | null = null;

function snapshot(): PartialProfile {
  if (cache === null) cache = read();
  return cache;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next: PartialProfile): void {
  cache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private browsing and full quotas both throw; persistence is a
      // convenience, and the in-memory cache still holds for this session.
    }
  }
  for (const listener of listeners) listener();
}

export function setAnswer<K extends keyof OperatorProfile>(
  key: K,
  value: OperatorProfile[K],
): void {
  commit({ ...snapshot(), [key]: value });
}

export function clearProfile(): void {
  commit({});
}

const REQUIRED: Array<keyof OperatorProfile> = [
  "capital",
  "build",
  "horizon",
  "team",
  "regulatory",
];

export function isComplete(p: PartialProfile): p is OperatorProfile {
  return REQUIRED.every((k) => p[k] !== undefined);
}

/** Server renders an empty profile, so the survey never flashes a stale answer. */
export function useOperatorProfile(): PartialProfile {
  return useSyncExternalStore(subscribe, snapshot, () => ({}));
}
