// Elevation for the measure and route-draw tools, read from the DEM.
//
// ONLINE ONLY, and deliberately not treated as a failure when it isn't. Drawing
// a route in the field is the offline case the whole outbox exists for, so the
// tools stay fully usable with no elevation: distance needs no data and is
// always right, and the profile fills in whenever there is signal. A null
// profile here means "not known", never "flat".
//
// Debounced because a drawn line changes on every tap, and a request per tap
// would be one round trip per finger-press for a number the user reads once.
//
// GUEST-SAFE: a guest has no account for this request to authenticate, so it
// is not made at all. Skipping rather than failing is the rule for every
// server call in this app (mobile/CLAUDE.md) — a guaranteed 401 per tap is a
// battery cost and a permanently red sync health line, and it would arrive
// once per finger-press on the measure tool. Gated HERE rather than in the
// three screens that call this, so a fourth caller cannot reintroduce it.
//
// PRIVACY: the request body is the line being drawn — precise wilderness
// coordinates. It goes to our own API and nowhere else; never log it.
import { useEffect, useRef, useState } from "react";
import type { ElevationProfile } from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { useAccountState } from "../auth/AccountStateContext";

/** Settle time after the last point change before asking for a profile. */
export const ELEVATION_DEBOUNCE_MS = 700;

export type ElevationState = {
  profile: ElevationProfile | null;
  loading: boolean;
};

export function useElevationProfile(
  points: readonly [number, number][],
): ElevationState {
  const [profile, setProfile] = useState<ElevationProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const isGuest = useAccountState().accountState === "guest";
  // Identity of the geometry, so a re-render with the same points does not
  // re-request and a moved vertex does.
  const geometryKey =
    points.length >= 2 && !isGuest ? JSON.stringify(points) : null;
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
      apiFetch<ElevationProfile>("/elevation/profile", {
        method: "POST",
        body: { points: JSON.parse(geometryKey) as [number, number][] },
      })
        .then((result) => {
          if (latestKey.current === geometryKey) setProfile(result);
        })
        .catch(() => {
          // Offline or a DEM hiccup. Swallowed on purpose: this is an
          // enrichment on a tool that must keep working without it, and a
          // toast per tap while out of signal would be noise. Nothing is
          // logged — the failure detail could carry the request body.
          if (latestKey.current === geometryKey) setProfile(null);
        })
        .finally(() => {
          if (latestKey.current === geometryKey) setLoading(false);
        });
    }, ELEVATION_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [geometryKey]);

  return { profile, loading };
}
