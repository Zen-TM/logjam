// Tracks + waypoints for the map + picker UI. Mirrors useGeoPdfImports:
// refreshes on DB mutations, exposes a loaded flag for app-lock arming.
import { useEffect, useState } from "react";

import {
  listTracks,
  listWaypoints,
  onTracksChanged,
  type Track,
  type Waypoint,
} from "./tracksDb";

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
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      Promise.all([listTracks(), listWaypoints()])
        .then(([tracks, waypoints]) => {
          if (mounted) setState({ tracks, waypoints, loaded: true });
        })
        .catch(console.error);
    };
    refresh();
    const unsubscribe = onTracksChanged(refresh);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  return state;
}
