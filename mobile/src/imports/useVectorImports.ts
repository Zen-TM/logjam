// Imports list for the map + picker UI. Mirrors useMapArtifacts: refreshes on
// registry mutations, exposes a loaded flag for the app-lock arming logic.
import { useEffect, useState } from "react";

import {
  listVectorImports,
  onImportsChanged,
  type VectorImport,
} from "./importsDb";
import { ensureImportOnDevice } from "./vectorImports";

export type VectorImportsState = {
  imports: VectorImport[];
  /** True once the first read completed (see useMapArtifacts.loaded). */
  loaded: boolean;
};

export function useVectorImports(): VectorImportsState {
  const [state, setState] = useState<VectorImportsState>({
    imports: [],
    loaded: false,
  });
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      listVectorImports()
        .then((rows) => {
          if (!mounted) return;
          setState({ imports: rows, loaded: true });
          // A file imported on another device arrives as a row with no bytes.
          // Fetching them for the ones the user has switched ON is what turns
          // "it is in your list" into "it is on your map"; the rest wait until
          // they are asked for. Fire-and-forget: `ensureImportOnDevice` writes
          // through the registry, which notifies this hook again.
          for (const row of rows) {
            if (row.visible && row.path === null) {
              void ensureImportOnDevice(row.id).catch(() => {
                // Offline, most often. The row stays listed without a line,
                // and the next refresh tries again.
              });
            }
          }
        })
        .catch(console.error);
    };
    refresh();
    const unsubscribe = onImportsChanged(refresh);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  return state;
}
