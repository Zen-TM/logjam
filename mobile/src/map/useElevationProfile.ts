// Elevation for the measure and route-draw tools, read from the DEM.
//
// LOCAL FIRST. If a saved region covers the line, the heights come off this
// phone (`offline/demLookup.ts`) — no request, no signal needed. Only when
// nothing on disk covers the line does it fetch the public terrarium tiles,
// which are the same tile set at the same zoom, so the two answers agree.
//
// Still never a failure. Drawing a route in the field is the offline case the
// whole outbox exists for, so the tools stay fully usable with no elevation:
// distance needs no data and is always right, and the profile fills in from
// whichever source can answer. A null profile means "not known", never "flat".
//
// Debounced because a drawn line changes on every tap, and a request per tap
// would be one round trip per finger-press for a number the user reads once.
//
// GUESTS INCLUDED. The tiles are a public dataset needing no account, so this
// no longer skips the network for a guest — elevation is one of the few things
// a guest now gets in full.
//
// PRIVACY: the line being drawn is precise wilderness coordinates, and they
// never leave the device — only TILE INDICES do, a ~4.9 km cell, to AWS's
// public bucket. See the privacy note in `offline/demLookup.ts` for what that
// trades. Never log the line.
import { useEffect, useRef, useState } from "react";
import {
  buildElevationProfile,
  densifyLine,
  type ElevationProfile,
} from "@logjam/shared";

import { sampleElevations } from "../offline/demLookup";

/** Settle time after the last point change before asking for a profile. */
export const ELEVATION_DEBOUNCE_MS = 700;

export type ElevationState = {
  profile: ElevationProfile | null;
  loading: boolean;
};

/**
 * A profile from the DEM, saved tiles first and the network for whatever they
 * do not cover.
 *
 * "Covers" is decided by the heights themselves rather than by bbox arithmetic:
 * a line can start inside a saved area and run out of it, and the useful answer
 * there is the part we know. Null only when NOTHING is known.
 */
async function profileFromDem(
  points: readonly [number, number][],
): Promise<ElevationProfile | null> {
  const positions = densifyLine(points);
  const elevations = await sampleElevations(positions, { allowNetwork: true });
  if (elevations.every((value) => value == null)) return null;
  return buildElevationProfile(positions, elevations);
}

export function useElevationProfile(
  points: readonly [number, number][],
): ElevationState {
  const [profile, setProfile] = useState<ElevationProfile | null>(null);
  const [loading, setLoading] = useState(false);
  // Identity of the geometry, so a re-render with the same points does not
  // re-request and a moved vertex does.
  const geometryKey = points.length >= 2 ? JSON.stringify(points) : null;
  // Guards against a slow response for an older line landing after a newer
  // one — without it, undoing a point could leave the pre-undo profile on
  // screen.
  const latestKey = useRef<string | null>(null);

  useEffect(() => {
    latestKey.current = geometryKey;
    if (!geometryKey) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      const points = JSON.parse(geometryKey) as [number, number][];
      void (async () => {
        try {
          const built = await profileFromDem(points);
          if (latestKey.current === geometryKey) setProfile(built);
        } catch {
          // Offline with nothing saved here, or a DEM hiccup. Swallowed on
          // purpose: this is an enrichment on a tool that must keep working
          // without it, and a toast per tap while out of signal would be
          // noise. Nothing is logged — the detail could carry the line.
          if (latestKey.current === geometryKey) setProfile(null);
        } finally {
          if (latestKey.current === geometryKey) setLoading(false);
        }
      })();
    }, ELEVATION_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [geometryKey]);

  return { profile, loading };
}
