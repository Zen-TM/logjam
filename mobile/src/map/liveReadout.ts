// The map's live speed + elevation readout — the value, and where it comes
// from.
//
// OUTSIDE REACT STATE, for the same reason the heading is (mobile/CLAUDE.md,
// Battery): a value that moves with every fix, put in `MapScreen`'s state,
// re-renders the whole map — MLRN memoises none of its layer components and
// re-commits props per layer per render, and the Protomaps band alone is ~71
// layers. The chip subscribes; nothing else does.
//
// PRIVACY: a speed and a height. No position is stored here and none is
// published — the coordinate that produced them stays in `MapScreen`.
import { useSyncExternalStore } from "react";

import { haversineMeters } from "@logjam/shared";

/**
 * A fix older than this says nothing about how fast someone is moving NOW.
 *
 * It has to exist because the map's watcher is `timeInterval` AND
 * `distanceInterval` (Android ANDs them), so a phone standing still stops
 * producing fixes ENTIRELY — with no staleness rule the chip would keep
 * reporting the speed of the last time the user walked, indefinitely, which is
 * the one number it must never show. 20 s is a comfortable six watcher
 * intervals: long enough that an ordinary skipped fix does not blank the chip,
 * short enough that a stop reads as a stop.
 */
export const READOUT_STALE_MS = 20_000;

/**
 * The shortest gap this will divide a distance by.
 *
 * Two fixes 200 ms apart are delivery jitter, not travel; dividing a real
 * (noisy) displacement by that manufactures a speed of tens of km/h out of GPS
 * wander. Same reasoning as `HEADING_RATE_MIN_GAP_MS` on the compass.
 */
const MIN_DERIVE_GAP_MS = 1000;

export type ReadoutFix = {
  lon: number;
  lat: number;
  /**
   * What the platform said, in m/s. Android's fused provider derives this from
   * GNSS Doppler shift rather than from successive positions, which is why it
   * is preferred below — it is a direct measurement, and it is right about a
   * slow walk where differencing two 5 m-accurate positions is not.
   *
   * Null or negative means "not known" (expo passes the platform's own -1
   * sentinel straight through).
   */
  speedMps: number | null;
  atMs: number;
};

/**
 * Speed for one fix: the platform's own if it has one, else differenced from
 * the previous fix, else unknown.
 *
 * Never zero-as-unknown: standing still and not knowing are different answers,
 * and only one of them should read "0.0 km/h".
 */
export function deriveSpeedMps(
  current: ReadoutFix,
  previous: ReadoutFix | null,
): number | null {
  if (
    current.speedMps != null &&
    Number.isFinite(current.speedMps) &&
    current.speedMps >= 0
  ) {
    return current.speedMps;
  }
  if (!previous) return null;
  const gapMs = current.atMs - previous.atMs;
  if (gapMs < MIN_DERIVE_GAP_MS || gapMs > READOUT_STALE_MS) return null;
  const metres = haversineMeters(previous.lat, previous.lon, current.lat, current.lon);
  return metres / (gapMs / 1000);
}

export type LiveReadout = {
  speedMps: number | null;
  elevationM: number | null;
  /** True when the height came from the terrain rather than from the handset —
   *  the chip says which, because the two can differ by a lot. */
  fromTerrain: boolean;
  /** When the fix behind this arrived, for the staleness rule above. */
  atMs: number;
};

let live: LiveReadout | null = null;
const listeners = new Set<() => void>();

/** Publish a readout (or null when the watcher stops). */
export function publishLiveReadout(next: LiveReadout | null): void {
  live = next;
  for (const listener of listeners) listener();
}

function getLiveReadout(): LiveReadout | null {
  return live;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The live readout, re-rendering only the component that reads it. */
export function useLiveReadout(): LiveReadout | null {
  return useSyncExternalStore(subscribe, getLiveReadout);
}
