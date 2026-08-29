// Tracks + waypoints for the map + picker UI. Mirrors useGeoPdfImports:
// refreshes on DB mutations, exposes a loaded flag for app-lock arming.
import { useCallback, useState } from "react";

import { listTracks, type Track } from "./tracksDb";
import { useTrackChangeRefresh } from "./useTrackChangeRefresh";

export type TracksState = {
  tracks: Track[];
  /** True once the first read completed (see useMapArtifacts.loaded). */
  loaded: boolean;
};

export function useTracks(): TracksState {
  const [state, setState] = useState<TracksState>({ tracks: [], loaded: false });
  const refresh = useCallback(() => {
    listTracks()
      .then((tracks) => setState({ tracks, loaded: true }))
      .catch(console.error);
  }, []);
  useTrackChangeRefresh(refresh);
  return state;
}
