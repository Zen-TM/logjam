import { compassPointFor, formatDistanceM, splitUnit } from "@logjam/shared";

import { fixAgeLabel, type FixQuality } from "./gpsSignal";

/**
 * What `NavReadout` says, as of `nowMs`: the two figures, and how far to trust
 * them. Stale, they grey and carry the fix's age; coarse, the distance is
 * "about". Both come from the same `fixQuality` as the arrow and the speed chip
 * (guard: navFigures.test.ts).
 */
export function navFigures(
  distanceM: number | null,
  bearingDeg: number | null,
  quality: FixQuality,
  fixAtMs: number | null,
  nowMs: number,
): {
  /** False before the first fix: both figures are a dash. */
  known: boolean;
  distance: string;
  unit: string;
  bearing: string;
  about: boolean;
  grey: boolean;
  age: string | null;
} {
  const known = distanceM != null && bearingDeg != null;
  const [distance, unit] = known
    ? splitUnit(formatDistanceM(distanceM))
    : ["—", ""];
  const stale = quality === "stale";
  return {
    known,
    distance,
    unit,
    bearing: known
      ? `${compassPointFor(bearingDeg)} ${Math.round(bearingDeg)}°`
      : "—",
    about: known && quality === "coarse",
    grey: stale,
    age: stale && fixAtMs != null ? fixAgeLabel(nowMs - fixAtMs) : null,
  };
}
