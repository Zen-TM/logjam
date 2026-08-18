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
// 3. The public terrarium tiles, fetched direct. The fallback: a guest has no
//    account to authenticate the API call with, and a deployed API older than
//    this app has no such route. It costs the privacy 2 was protecting, which
//    is why it is last rather than first.
//
// All three read the same tile set at the same zoom, so the answers agree.
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
import { useEffect, useRef, useState } from "react";
import {
  buildElevationProfile,
  densifyLine,
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
 * a line can start inside a saved area and run out of it, and the useful answer
 * there is the part we know — so a partial local answer WINS, and costs no
 * request. Null only when nothing anywhere is known.
 */
async function profileFromDem(
  points: readonly [number, number][],
  sources: { api: boolean; tiles: boolean },
): Promise<ElevationProfile | null> {
  const positions = densifyLine(points);

  const saved = await sampleElevations(positions);
  if (saved.some((value) => value != null)) {
    return buildElevationProfile(positions, saved);
  }

  if (sources.api) {
    try {
      return await apiFetch<ElevationProfile>("/elevation/profile", {
        method: "POST",
        body: { points },
      });
    } catch {
      // A deployed API older than this app has no such route, and a flaky link
      // is a flaky link. Either way the tiles below can still answer, so this
      // is a fall-through rather than a failure. Not logged: the error could
      // carry the line.
    }
  }

  if (!sources.tiles) return null;
  const fetched = await sampleElevations(positions, { allowNetwork: true });
  if (fetched.every((value) => value == null)) return null;
  return buildElevationProfile(positions, fetched);
}

export function useElevationProfile(
  points: readonly [number, number][],
  { allowNetwork = true }: { allowNetwork?: boolean } = {},
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
          const built = await profileFromDem(
            points,
            planElevationSources({ allowNetwork, isGuest }),
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
  }, [geometryKey, allowNetwork, isGuest]);

  return { profile, loading };
}
