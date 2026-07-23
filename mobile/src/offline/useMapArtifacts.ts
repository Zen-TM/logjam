// Registry-backed artifact list for the map resolver + downloads UI.
// Refreshes on registry mutations via onRegistryChanged.
import { useEffect, useState } from "react";

import type { MapArtifact } from "../map/sourceResolver";
import { listArtifacts, onRegistryChanged } from "./registryDb";

export function useMapArtifacts(): MapArtifact[] {
  const [artifacts, setArtifacts] = useState<MapArtifact[]>([]);
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      listArtifacts()
        .then((rows) => {
          if (mounted) setArtifacts(rows);
        })
        // Best-effort: an unreadable registry renders as "no offline data";
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
  return artifacts;
}
