// The three verbs every saved asset supports — *show on map*, *rename*,
// *delete* — as one descriptor per kind (DESIGN.md §7: uniformity is the
// feature).
//
// This exists because there are now TWO places that offer them: the Saved
// screen's per-item overflow sheet, and the map's layer sheet, where a GeoPDF
// or a recorded track you can see on the map should be flyable-to and
// deletable without a trip to another tab. Two copies of "what does Delete
// mean for a GeoPDF" is how the copy on one of them goes stale.
//
// Regions and topo overlays are NOT here: they are registry artifacts with no
// per-item row in the layer sheet, and their verbs stay inline in SavedScreen.
import { deleteGeoPdfImport } from "../geopdf/importPipeline";
import { updateGeoPdfImport, type GeoPdfImport } from "../geopdf/geoPdfImportsDb";
import { renameVectorImport, type VectorImport } from "../imports/importsDb";
import { deleteVectorImport } from "../imports/vectorImports";
import { deleteTrack, listTrackPoints, updateTrack, type Track } from "../tracks/tracksDb";
import { bboxOfPoints, type Bbox } from "./bboxOfPoints";

export type AssetActions = {
  /** False when the asset has no geographic extent to fly to. */
  locatable: boolean;
  /** Resolved on tap — a track's extent needs its points read back. */
  resolveBbox: () => Promise<Bbox | null>;
  /** Display-only rename; resolution still keys off ids. */
  rename: (name: string) => Promise<unknown>;
  delete: { confirmTitle: string; confirmBody: string; run: () => Promise<unknown> };
};

export function geoPdfActions(geoPdf: GeoPdfImport): AssetActions {
  return {
    locatable: geoPdf.bbox != null,
    resolveBbox: async () => geoPdf.bbox,
    rename: (name) => updateGeoPdfImport(geoPdf.id, { label: name }),
    delete: {
      confirmTitle: "Delete this GeoPDF?",
      confirmBody: "The imported map and its tiles are removed from the device.",
      run: () => deleteGeoPdfImport(geoPdf.id),
    },
  };
}

export function vectorImportActions(imported: VectorImport): AssetActions {
  return {
    locatable: true,
    resolveBbox: async () => imported.bbox,
    rename: (name) => renameVectorImport(imported.id, name),
    delete: {
      confirmTitle: "Delete this import?",
      confirmBody: "The imported features are removed from the device and the map.",
      run: () => deleteVectorImport(imported.id),
    },
  };
}

export function trackActions(track: Track): AssetActions {
  return {
    locatable: track.pointCount > 0,
    // A track's extent isn't stored; derive it from its points on demand.
    resolveBbox: async () => bboxOfPoints(await listTrackPoints(track.id)),
    rename: (name) => updateTrack(track.id, { name }),
    delete: {
      confirmTitle: "Delete track?",
      confirmBody: "The recorded points are deleted. This can't be undone.",
      run: () => deleteTrack(track.id),
    },
  };
}
