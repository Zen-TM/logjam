// Connectivity state for map source resolution (map-sources.md §7).
// Asymmetric hysteresis: flip to offline immediately (a blank basemap request
// should never wait), but require a short ONLINE_STABLE_MS of continuous
// reachability before flipping back online — so reception flapping at a
// canyon rim doesn't thrash source remounts.
//
// Reachability currently trusts NetInfo's isInternetReachable. The spec's
// own-CDN healthz probe rides on the (operator-gated) CDN infra work —
// flagged in OPERATOR_SETUP; swap the probe in when healthz.txt exists.
import { useEffect, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

export type Connectivity = "online" | "offline" | "forced-offline";

/**
 * How long reachability must hold before the app calls itself online.
 *
 * Was 10 s, which is what a returning user actually felt: the basemap and every
 * online-gated control sat dead for a measured 12 s after the signal came back.
 * 3 s still absorbs the flap this window exists for — and it now guards a
 * NATIVE-VALIDATED reachability signal rather than a bare `isConnected`, so a
 * flip through it is far less chatty than when the 10 s was chosen.
 *
 * ponytail: a fixed window, not a flap-aware one. If a rim-of-canyon link ever
 * proves it can thrash the map's sources at 3 s, make the window grow when
 * offline follows online inside it, rather than raising the floor for everyone.
 */
export const ONLINE_STABLE_MS = 3_000;

/**
 * Fire `onReconnect` on the offline → online edge.
 *
 * NOT keyed on `isConnected`, which is what every caller used to do
 * independently: a phone with a VPN (or any interface that stays up) reports
 * `isConnected: true` while the link is dead. Measured on a Pixel 9 with Wi-Fi
 * and mobile data both off — NetInfo kept saying `type=vpn isConnected=true`,
 * so the edge never fired and sync waited out its 5-minute backoff instead of
 * recovering the moment the signal came back.
 *
 * `isInternetReachable === null` means "checking"; it is ignored rather than
 * counted either way, so a re-check doesn't manufacture an edge.
 */
export function subscribeReconnect(onReconnect: () => void): () => void {
  let wasReachable: boolean | null = null;
  return NetInfo.addEventListener((state) => {
    if (state.isInternetReachable == null) return;
    const reachable = state.isConnected === true && state.isInternetReachable;
    if (reachable && wasReachable === false) onReconnect();
    wasReachable = reachable;
  });
}

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
