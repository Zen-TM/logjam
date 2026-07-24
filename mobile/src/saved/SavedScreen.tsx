// Saved tab — on-device map assets: downloaded regions/overlays, imported
// GeoPDFs and vector files, recorded tracks. Backed by the existing offline
// registry + geopdf/tracks data layers (no data-layer work).
//
// NOTE: this is the Phase-0 placeholder that locks the `Saved` route. The full
// screen (storage header, region download, on-device list, GeoPDF/import/track
// management relocated out of the map layer sheet) is built in the Map+Saved
// batch.
import { EmptyState } from "../ui";

export function SavedScreen() {
  return (
    <EmptyState
      title="Saved"
      hint="Downloaded maps, imports and tracks will live here."
    />
  );
}
