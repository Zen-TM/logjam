// Where the map was last looking, so the offline-download screen opens on the
// same ground however it was reached.
//
// A module store rather than navigation params: the download screen is reached
// from the map (which has a camera to hand) AND from the Saved tab (which does
// not), and the Saved route used to drop the user on the app's default view of
// the whole Blue Mountains, to pan back to where they already were.
//
// PRIVACY: a centre and a zoom in memory for the life of the process. Never
// persisted, never logged — same rule as MapScreen's own camera state.
import type { BasemapId } from "./sourceResolver";

export type MapCamera = {
  center: [number, number];
  zoom: number;
  basemapId: BasemapId;
};

let lastCamera: MapCamera | null = null;

export function rememberMapCamera(camera: MapCamera): void {
  lastCamera = camera;
}

/** Null before the map has ever settled — the caller falls back to defaults. */
export function readLastMapCamera(): MapCamera | null {
  return lastCamera;
}
