// Profiles already sampled, kept for as long as the tab lives.
//
// WHY THIS EXISTS. A profile is a round trip to the DEM, and the same geometry
// is asked for repeatedly: opening a way, editing it, and leaving the editor
// are three requests for a line nobody touched (measured 2026-09-17). Now that
// the editor shows the same page the detail view does, that is three answers to
// one question. `useElevationProfile` already claimed this in its docstring —
// "reopening the same route does not [re-sample]" — and did not do it; this is
// the implementation that makes the sentence true, with a test so it stays so.
//
// WHY CACHING IS SAFE HERE, when `shared/src/elevation.ts` says a profile is
// never persisted. That rule is about STORING a profile against a Route: it
// would go stale the moment a vertex moved, and the geometry must stay the one
// source of truth. Keying on the exact point list keeps both properties — move
// a vertex and the key changes, so it re-samples — while a DEM is, in that
// module's own words, "a fixed surface, so re-reading the same point gives the
// same answer". Nothing here outlives the tab, and nothing is written down.
//
// PRIVACY: the key is a route's point list, which is precise wilderness
// location data. It stays in memory, is never logged, and never leaves here.
import type { ElevationProfile } from "@logjam/shared";

/** What the server returns, credit included. */
export type CachedProfile = ElevationProfile & { attribution: string };

/**
 * How many lines to remember. A profile is at most
 * `ELEVATION_PROFILE_MAX_SAMPLES` (256) samples, so forty of them is a few
 * hundred KB at worst — enough to cover a session's worth of opening, editing
 * and reopening without being a place memory quietly accumulates.
 */
const MAX_ENTRIES = 40;

/** Insertion order IS the recency order: a read re-inserts. */
const entries = new Map<string, CachedProfile>();

/** The profile for this exact geometry, or null if it has not been sampled. */
export function cachedProfile(key: string): CachedProfile | null {
  const hit = entries.get(key);
  if (hit === undefined) return null;
  // Re-insert so the least recently USED is evicted, not the oldest stored —
  // the line someone keeps returning to is the one worth keeping.
  entries.delete(key);
  entries.set(key, hit);
  return hit;
}

export function cacheProfile(key: string, profile: CachedProfile): void {
  entries.delete(key);
  entries.set(key, profile);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
}

/** Test seam. Nothing in the app clears this: a tab reload is the only reset,
 *  and a profile cannot go stale for geometry that has not changed. */
export function clearProfileCache(): void {
  entries.clear();
}

/** How many lines are remembered. For the test, and for nothing else. */
export function cachedProfileCount(): number {
  return entries.size;
}
