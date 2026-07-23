// Imports list for the map + picker UI. Mirrors useMapArtifacts: refreshes on
// registry mutations, exposes a loaded flag for the app-lock arming logic.
import { useEffect, useState } from "react";

import {
  listVectorImports,
  onImportsChanged,
  type VectorImport,
} from "./importsDb";

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
          if (mounted) setState({ imports: rows, loaded: true });
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
