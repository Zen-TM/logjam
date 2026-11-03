// The map's live speed + elevation readout — the value, and where it comes
// from.
//
// OUTSIDE REACT STATE, for the same reason the heading is (mobile/AGENTS.md,
// Privacy and battery): a value that moves with every fix, put in
// `MapScreen`'s state, re-renders the whole map — MLRN memoises none of its
// layer components and re-commits props per layer per render, and the
// Protomaps band alone is ~71 layers. The chip subscribes; nothing else does.
//
// PRIVACY: a speed and a height. No position is stored here and none is
// published — the coordinate that produced them stays in `MapScreen`.
import { useSyncExternalStore } from "react";

import { haversineMeters } from "@logjam/shared";

import {
  FIX_STALE_MS,
  fixAgeLabel,
  fixQuality,
  type FixQuality,
} from "./gpsSignal";

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
  /** When the platform says the fix was taken. Only differences of these are
   *  used (a skewed clock cancels out); the age of a fix is `LiveReadout.atMs`. */
  timeMs: number;
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
  const gapMs = current.timeMs - previous.timeMs;
  if (gapMs < MIN_DERIVE_GAP_MS || gapMs > FIX_STALE_MS) return null;
  const metres = haversineMeters(
    previous.lat,
    previous.lon,
    current.lat,
    current.lon,
  );
  return metres / (gapMs / 1000);
}

export type LiveReadout = {
  speedMps: number | null;
  elevationM: number | null;
  /** True when the height came from the terrain rather than from the handset —
   *  the chip says which, because the two can differ by a lot. */
  fromTerrain: boolean;
  /** When the fix behind this arrived, for `fixQuality` (gpsSignal.ts). */
  atMs: number;
  /** Metres, 68% confidence, so a tower fix reads as "about". */
  accuracyM: number | null;
};

/**
 * What the chip draws, as of `nowMs`.
 *
 * A stale fix invalidates the SPEED but not the height: the ground under you
 * is still the ground under you, so the height stays, greyed and with its age.
 * Quality is `fixQuality`'s, the one rule every figure from the position reads
 * (guard: liveReadout.test.ts).
 */
export function readoutFigures(
  readout: LiveReadout | null,
  nowMs: number,
): {
  quality: FixQuality;
  speedMps: number | null;
  elevationM: number | null;
  /** Set when stale: how long ago the fix behind the figures was. */
  age: string | null;
} {
  const quality = fixQuality(readout, nowMs);
  const stale = quality === "stale";
  return {
    quality,
    speedMps: stale ? null : (readout?.speedMps ?? null),
    elevationM: readout?.elevationM ?? null,
    age: stale && readout ? fixAgeLabel(nowMs - readout.atMs) : null,
  };
}

let live: LiveReadout | null = null;
const listeners = new Set<() => void>();

/** Publish a readout (or null when the watcher stops). */
export function publishLiveReadout(next: LiveReadout | null): void {
  live = next;
  for (const listener of listeners) listener();
}

/**
 * The terrain's height for the current fix. It merges into whatever is
 * published NOW rather than rebuilding the reading it was asked for, so a
 * slow tile read cannot put an older age or speed back.
 */
export function publishTerrainElevation(elevationM: number): void {
  if (live) publishLiveReadout({ ...live, elevationM, fromTerrain: true });
}

/**
 * A fix arrived that moved too little to act on. It still proves the sky is
 * there, so the figures keep their height and are not aged for standing still.
 */
export function refreshLiveReadout(
  atMs: number,
  accuracyM: number | null,
  speedMps: number | null,
): void {
  if (live) publishLiveReadout({ ...live, atMs, accuracyM, speedMps });
}

export function getLiveReadout(): LiveReadout | null {
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

/** The unit's leading space, unbreakable: at a large text size "km/h" wrapped
 *  under its figure. Guard: liveReadout.test.ts. */
export function keepWithValue(unit: string): string {
  return unit.replace(" ", "\u00A0");
}
