// Tracks + waypoints for the map + picker UI. Mirrors useGeoPdfImports:
// refreshes on DB mutations, exposes a loaded flag for app-lock arming.
import { useCallback, useState } from "react";

import { listTracks, listWaypoints, type Track, type Waypoint } from "./tracksDb";
import { useTrackChangeRefresh } from "./useTrackChangeRefresh";

export type TracksState = {
  tracks: Track[];
  waypoints: Waypoint[];
  /** True once the first read completed (see useMapArtifacts.loaded). */
  loaded: boolean;
};

export function useTracks(): TracksState {
  const [state, setState] = useState<TracksState>({
    tracks: [],
    waypoints: [],
    loaded: false,
  });
  const refresh = useCallback(() => {
    Promise.all([listTracks(), listWaypoints()])
      .then(([tracks, waypoints]) => setState({ tracks, waypoints, loaded: true }))
      .catch(console.error);
  }, []);
  useTrackChangeRefresh(refresh);
  return state;
}
