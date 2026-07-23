// Registry-backed artifact list for the map resolver + downloads UI.
// Refreshes on registry mutations via onRegistryChanged.
import { useEffect, useState } from "react";

import type { MapArtifact } from "../map/sourceResolver";
import { listArtifacts, onRegistryChanged } from "./registryDb";

export type MapArtifactsState = {
  artifacts: MapArtifact[];
  /**
   * True once the first registry read has completed. Lets AppLockGate tell a
   * cold start with existing artifacts (rows arrive WITH the first load →
   * lock) apart from the first artifact landing mid-session (load completed
   * empty earlier → arm for the next background, don't slam the gate now).
   */
  loaded: boolean;
};

export function useMapArtifacts(): MapArtifactsState {
  const [state, setState] = useState<MapArtifactsState>({
    artifacts: [],
    loaded: false,
  });
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      listArtifacts()
        .then((rows) => {
          if (mounted) setState({ artifacts: rows, loaded: true });
        })
        // Best-effort: an unreadable registry renders as "no offline data"
        // (loaded stays false — never treated as a confirmed-empty session);
        // the downloads screen surfaces persistent failures.
        .catch(console.error);
    };
    refresh();
    const unsubscribe = onRegistryChanged(refresh);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  return state;
}
