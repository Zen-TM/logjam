// Elevation for the measure and route-draw tools, read from the DEM.
//
// LOCAL FIRST. If a saved region covers the line, the heights come off this
// phone (`offline/demLookup.ts`) — no request, no signal needed, and a guest
// gets them too. Only when nothing on disk covers the line does it ask the API,
// which reads the same tile set at the same zoom, so the two answers agree.
//
// Still never a failure. Drawing a route in the field is the offline case the
// whole outbox exists for, so the tools stay fully usable with no elevation:
// distance needs no data and is always right, and the profile fills in from
// whichever source can answer. A null profile means "not known", never "flat".
//
// Debounced because a drawn line changes on every tap, and a request per tap
// would be one round trip per finger-press for a number the user reads once.
//
// GUEST-SAFE: a guest has no account for the API request to authenticate, so it
// is not made at all — the local read still is. Skipping rather than failing is
// the rule for every server call in this app (mobile/CLAUDE.md). Gated HERE
// rather than in the three screens that call this, so a fourth caller cannot
// reintroduce it.
//
// PRIVACY: the line being drawn is precise wilderness coordinates. The local
// path keeps it on the device entirely; the API path sends it to our own API
// and nowhere else. Never log it.
import { useEffect, useRef, useState } from "react";
import {
  buildElevationProfile,
  densifyLine,
  type ElevationProfile,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { useAccountState } from "../auth/AccountStateContext";
import { sampleElevationsOffline } from "../offline/demLookup";

/** Settle time after the last point change before asking for a profile. */
export const ELEVATION_DEBOUNCE_MS = 700;

export type ElevationState = {
  profile: ElevationProfile | null;
  loading: boolean;
};

/**
 * A profile from the DEM saved on this device, or null when no saved region
 * covers the line.
 *
 * "Covers" is decided by the heights themselves rather than by bbox arithmetic:
 * a line can start inside a saved area and run out of it, and the useful answer
 * there is the part we know. Null only when NOTHING is known — that is the case
 * worth a round trip.
 */
async function profileFromSavedRegions(
  points: readonly [number, number][],
): Promise<ElevationProfile | null> {
  const positions = densifyLine(points);
  const elevations = await sampleElevationsOffline(positions);
  if (elevations.every((value) => value == null)) return null;
  return buildElevationProfile(positions, elevations);
}

export function useElevationProfile(
  points: readonly [number, number][],
): ElevationState {
  const [profile, setProfile] = useState<ElevationProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const isGuest = useAccountState().accountState === "guest";
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
          const local = await profileFromSavedRegions(points);
          if (local) {
            if (latestKey.current === geometryKey) setProfile(local);
            return;
          }
          if (isGuest) {
            if (latestKey.current === geometryKey) setProfile(null);
            return;
          }
          const remote = await apiFetch<ElevationProfile>("/elevation/profile", {
            method: "POST",
            body: { points },
          });
          if (latestKey.current === geometryKey) setProfile(remote);
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
  }, [geometryKey, isGuest]);

  return { profile, loading };
}
