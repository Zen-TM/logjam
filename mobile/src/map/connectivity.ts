// Connectivity state for map source resolution.
// Asymmetric hysteresis: flip to offline immediately (a blank basemap request
// should never wait), but require a short ONLINE_STABLE_MS of continuous
// reachability before flipping back online — so reception flapping at a
// place rim doesn't thrash source remounts.
//
// Reachability currently trusts NetInfo's isInternetReachable. Swap an
// own-CDN healthz probe in when healthz.txt exists.
import { useEffect, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

export type Connectivity = "online" | "offline" | "forced-offline";

/**
 * How long reachability must hold before Logjam GPS calls itself online.
 *
 * 3 s absorbs the flap this window exists for while guarding a
 * NATIVE-VALIDATED reachability signal rather than a bare `isConnected`.
 *
 * ponytail: a fixed window, not a flap-aware one. If a rim-of-place link ever
 * proves it can thrash the map's sources at 3 s, make the window grow when
 * offline follows online inside it, rather than raising the floor for everyone.
 */
export const ONLINE_STABLE_MS = 3_000;

/**
 * Fire `onReconnect` on the offline → online edge.
 *
 * NOT keyed on `isConnected`: a phone with a VPN (or any interface that stays
 * up) reports `isConnected: true` while the link is dead (NetInfo reports
 * `type=vpn isConnected=true`), which would prevent the edge from firing and
 * leave sync waiting out its backoff instead of recovering when the signal
 * returns (connectivity.test.ts).
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

/**
 * Whether the phone calls itself online right now, by the same reading as
 * `useConnectivity`. Answers from the state NetInfo already holds: nothing is
 * sent and nothing is armed.
 */
export async function isReachableNow(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
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
