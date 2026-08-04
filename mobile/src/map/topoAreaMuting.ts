// Which LiDAR areas are muted on the map (Map layers → Layers → Topo overlays).
//
// The topo overlay selection is a matrix: a layer kind (hillshade, contours…)
// crossed with the area it was rendered for. The two axes are stored
// separately BECAUSE they are independent questions:
//
//   what to draw  → `overlay_enabled` in registryDb, keyed "<jobId>/<layer>"
//   where to draw → this file, a set of muted jobIds
//
// An overlay renders when its cell is enabled AND its area is not muted. Muting
// therefore hides an area without destroying the layer selection underneath it,
// so unmuting brings back exactly what was showing before — which is the whole
// point of a "where" switch, and the reason this isn't derived from the cells.
//
// Muted rather than enabled, so absent means "nothing hidden": a freshly
// downloaded area shows up on the map, matching the auto-enable-on-download
// behaviour in SavedScreen.
//
// DEVICE-scoped in `prefsDb`, like the other map view preferences. PRIVACY: a
// jobId is an opaque UUID — no canyon name, no coordinate — and this store is
// app-private like every other database here.
import { readPref, writePref } from "../prefsDb";

const MUTED_AREAS_PREF_KEY = "topoMutedAreas";

/** Muted area ids, or an empty set when nothing is recorded/readable. */
export function readMutedTopoAreas(): ReadonlySet<string> {
  const stored = readPref(MUTED_AREAS_PREF_KEY);
  if (!stored) return new Set();
  try {
    const parsed: unknown = JSON.parse(stored);
    // A corrupted value means "nothing muted", not a crash on the map's first
    // render — the failure mode here is showing an overlay the user hid, which
    // they can see and fix, rather than a screen that won't mount.
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

/** False when the device refused to store it, so the caller can say so. */
export function writeMutedTopoAreas(areaIds: ReadonlySet<string>): boolean {
  return writePref(MUTED_AREAS_PREF_KEY, JSON.stringify([...areaIds]));
}
