// GeoPDF imports list for the map + picker UI. Mirrors useVectorImports:
// refreshes on registry mutations, exposes a loaded flag for the app-lock
// arming logic.
import { useEffect, useState } from "react";

import {
  listGeoPdfImports,
  onGeoPdfImportsChanged,
  type GeoPdfImport,
} from "./geoPdfImportsDb";

export type GeoPdfImportsState = {
  geoPdfImports: GeoPdfImport[];
  /** True once the first read completed (see useMapArtifacts.loaded). */
  loaded: boolean;
};

export function useGeoPdfImports(): GeoPdfImportsState {
  const [state, setState] = useState<GeoPdfImportsState>({
    geoPdfImports: [],
    loaded: false,
  });
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      listGeoPdfImports()
        .then((rows) => {
          if (mounted) setState({ geoPdfImports: rows, loaded: true });
        })
        .catch(console.error);
    };
    refresh();
    const unsubscribe = onGeoPdfImportsChanged(refresh);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  return state;
}
