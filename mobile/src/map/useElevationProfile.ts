// Elevation for the measure and route-draw tools, read from the DEM.
//
// THREE SOURCES, IN THIS ORDER, AND THE ORDER IS A PRIVACY DECISION.
//
// 1. The tiles saved on this phone (`offline/demLookup.ts`) — no request, no
//    signal, nothing observable by anyone.
// 2. Our API (`POST /elevation/profile`), when signed in. The server holds one
//    warm tile cache for web and mobile alike, and — the point — it fetches
//    the DEM tiles on ITS connection, so the tile indices that trace where the
//    user is drawing never leave the device. See api/src/services/elevation.ts.
// 3. The public DEM tiles, fetched direct. The fallback: a guest has no
//    account to authenticate the API call with, and a deployed API older than
//    this app has no such route. It costs the privacy 2 was protecting, which
//    is why it is last rather than first.
//
// All three read the same DEM sources at the same zoom (`sampleDem` in
// shared/src/demSources.ts), so the answers agree.
//
// Still never a failure. Drawing a route in the field is the offline case the
// whole outbox exists for, so the tools stay fully usable with no elevation:
// distance needs no data and is always right, and the profile fills in from
// whichever source can answer. A null profile means "not known", never "flat".
//
// Debounced because a drawn line changes on every tap, and a request per tap
// would be one round trip per finger-press for a number the user reads once.
//
// GUESTS INCLUDED, via source 3. The tiles need no account, so a guest gets
// elevation where before they got none.
//
// `allowNetwork: false` means "Simulating offline mode" — the map's offline-only
// toggle. Source 1 still answers, because reading what is already on the phone
// is exactly what that mode is for; 2 and 3 are both suppressed.
//
// PRIVACY: the line is precise wilderness coordinates. Source 2 sends it to our
// own API and nowhere else; source 3 sends only TILE INDICES (a ~4.9 km cell)
// to AWS's public bucket, from the user's own connection. Never log either.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildTrackElevationProfile,
  densifyLineSegments,
  type DemSamples,
  type GpsFix,
  type ElevationProfile,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { useAccountState } from "../auth/AccountStateContext";
import { sampleElevations } from "../offline/demLookup";
import { planElevationSources } from "./elevationSources";

/** Settle time after the last point change before asking for a profile. */
export const ELEVATION_DEBOUNCE_MS = 700;

export type ElevationState = {
  profile: ElevationProfile | null;
  loading: boolean;
};

/**
 * A profile from the DEM.
 *
 * "Covers" is decided by the heights themselves rather than by bbox arithmetic:
 * a line can start inside a saved area and run out of it. A COMPLETE local
 * answer wins outright and costs no request; a PARTIAL one is held as the
 * fallback while the network is still asked, because a caller that needs a
 * whole surface (`TrackStatsBody` falls back to GPS heights the moment one
 * sample is missing) would otherwise throw away a partial answer AND never
 * reach the source that could have completed it. Null only when nothing
 * anywhere is known.
 *
 * `gpsFixes` are a recorded track's own heights. Where no source completes
 * the profile they fill its gaps, so a track that strays past a saved area
 * keeps the DEM for the part inside it.
 *
 * `maxSamples` is the ceiling a track asks for (`ELEVATION_TRACK_MAX_SAMPLES`).
 * An API older than the field ignores it and answers at the default.
 */
async function profileFromDem(
  segments: readonly (readonly [number, number][])[],
  sources: { api: boolean; tiles: boolean },
  {
    gpsFixes,
    maxSamples,
  }: {
    gpsFixes?: readonly (readonly GpsFix[])[] | null;
    maxSamples?: number;
  } = {},
): Promise<ElevationProfile | null> {
  const positions = densifyLineSegments(segments, maxSamples);
  const buildElevationProfile = (
    at: typeof positions,
    dem: DemSamples,
  ): ElevationProfile =>
    buildTrackElevationProfile(segments, gpsFixes, at, dem);

  const saved = await sampleElevations(positions);
  if (saved.heights.every((value) => value != null)) {
    return buildElevationProfile(positions, saved);
  }
  const partial = saved.heights.some((value) => value != null)
    ? buildElevationProfile(positions, saved)
    : null;

  if (sources.api) {
    try {
      return await apiFetch<ElevationProfile>("/elevation/profile", {
        method: "POST",
        body: { segments, ...(maxSamples ? { maxSamples } : {}) },
      });
    } catch {
      // A deployed API older than this app has no such route, and a flaky link
      // is a flaky link. Either way the tiles below can still answer, so this
      // is a fall-through rather than a failure. Not logged: the error could
      // carry the line.
    }
  }

  if (!sources.tiles) return partial;
  const fetched = await sampleElevations(positions, { allowNetwork: true });
  if (fetched.heights.every((value) => value == null)) return partial;
  return buildElevationProfile(positions, fetched);
}

export function useElevationProfile(
  segments: readonly (readonly [number, number][])[],
  {
    allowNetwork = true,
    gpsFixes = null,
    maxSamples,
  }: {
    allowNetwork?: boolean;
    /** A recorded track's GPS heights along `segments`, to fill gaps. */
    gpsFixes?: readonly (readonly GpsFix[])[] | null;
    /** A track's higher sample ceiling; a drawn line leaves it out. */
    maxSamples?: number;
  } = {},
): ElevationState {
  const [profile, setProfile] = useState<ElevationProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const isGuest = useAccountState().accountState === "guest";
  // Identity of the geometry, so a re-render with the same points does not
  // re-request and a moved vertex does. A line needs at least two points
  // across its segments, as before.
  const totalPoints = segments.reduce((n, s) => n + s.length, 0);
  // Memoised: a live recording re-renders its panel every second, and the line
  // only changes every few dozen points — serialising it per render was the
  // single largest per-tick cost here.
  const geometryKey = useMemo(
    () => (totalPoints >= 2 ? JSON.stringify(segments) : null),
    [segments, totalPoints],
  );
  // Guards against a slow response for an older line landing after a newer
  // one — without it, undoing a point could leave the pre-undo profile on
  // screen.
  const latestKey = useRef<string | null>(null);
  // Every fix of a long recording: too much to put in the key, and it changes
  // only when the line does. Declared before the effect below, so it is
  // written first. A set that no longer matches the line fills nothing
  // (`gpsAlongLine`).
  const latestGpsFixes = useRef(gpsFixes);
  useEffect(() => {
    latestGpsFixes.current = gpsFixes;
  }, [gpsFixes]);

  // No line, no profile: cleared during render rather than from the effect.
  if (!geometryKey && (profile !== null || loading)) {
    setProfile(null);
    setLoading(false);
  }

  useEffect(() => {
    latestKey.current = geometryKey;
    if (!geometryKey) return;

    const timer = setTimeout(() => {
      setLoading(true);
      const segments = JSON.parse(geometryKey) as [number, number][][];
      void (async () => {
        try {
          const built = await profileFromDem(
            segments,
            planElevationSources({ allowNetwork, isGuest }),
            { gpsFixes: latestGpsFixes.current, maxSamples },
          );
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
  }, [geometryKey, allowNetwork, isGuest, maxSamples]);

  return { profile, loading };
}
