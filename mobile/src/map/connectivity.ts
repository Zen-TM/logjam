// Connectivity state for map source resolution (map-sources.md §7).
// Asymmetric hysteresis: flip to offline immediately (a blank basemap request
// should never wait), but require ONLINE_STABLE_MS of continuous
// reachability before flipping back online — so reception flapping at a
// canyon rim doesn't thrash source remounts.
//
// Reachability currently trusts NetInfo's isInternetReachable. The spec's
// own-CDN healthz probe rides on the (operator-gated) CDN infra work —
// flagged in OPERATOR_SETUP; swap the probe in when healthz.txt exists.
import { useEffect, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

export type Connectivity = "online" | "offline" | "forced-offline";

export const ONLINE_STABLE_MS = 10_000;

export function useConnectivity(forcedOffline = false): Connectivity {
  const [online, setOnline] = useState(true);
  const stableTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const reachable =
        state.isConnected === true && state.isInternetReachable !== false;
      if (!reachable) {
        // Offline: instant.
        if (stableTimer.current) {
          clearTimeout(stableTimer.current);
          stableTimer.current = null;
        }
        setOnline(false);
      } else {
        // Online: only after a stable window.
        if (stableTimer.current) return;
        stableTimer.current = setTimeout(() => {
          stableTimer.current = null;
          setOnline(true);
        }, ONLINE_STABLE_MS);
      }
    });
    return () => {
      unsubscribe();
      if (stableTimer.current) clearTimeout(stableTimer.current);
    };
  }, []);

  if (forcedOffline) return "forced-offline";
  return online ? "online" : "offline";
}
