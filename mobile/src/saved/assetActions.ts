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
import {
  createRouteLocal,
  deleteRouteLocal,
  updateRouteLocal,
} from "../sync/outbox";
import {
  MIN_ROUTE_POINTS,
  ROUTE_NAME_MAX_LENGTH,
  reverseRoute,
  reverseRouteAnchors,
  simplifyToFit,
  type RoutePoint,
} from "@logjam/shared";
import type { MirrorRoute } from "../sync/mirrorStore";
import { exportTrack, type ExportFormat } from "../fileExport";
import { bboxOfPoints, type Bbox } from "./bboxOfPoints";

export type AssetActions = {
  /** False when the asset has no geographic extent to fly to. */
  locatable: boolean;
  /** Resolved on tap — a track's extent needs its points read back. */
  resolveBbox: () => Promise<Bbox | null>;
  /** Display-only rename; resolution still keys off ids. */
  rename: (name: string) => Promise<unknown>;
  delete: { confirmTitle: string; confirmBody: string; run: () => Promise<unknown> };
  /**
   * Set on an editable route: the id the map's draw tool reopens. The action
   * itself is navigation, which lives with the screen, not here.
   */
  editableRouteId?: string;
  /**
   * Flip vertex order. Only routes have it: direction is semantic on a route
   * (approach vs exit, upstream vs downstream) and a recording's direction is
   * a fact about what happened, not an editable property.
   */
  reverse?: () => Promise<unknown>;
  /**
   * Turn a recording into an editable route. Non-destructive — the recording
   * is untouched — and simplifying is unavoidable: a real recording is
   * thousands of fixes and the cap is MAX_ROUTE_POINTS. Resolves with the
   * point count kept so the caller can say what happened.
   */
  createRouteFrom?: () => Promise<{ name: string; pointCount: number }>;
  /** Set a route's colour, from the shared TRACK_COLORS palette. */
  setColor?: (color: string) => Promise<unknown>;
  /**
   * Write the asset out as a GPX or KML file the user keeps. Resolves with the
   * filename written, or NULL when the user backed out of the folder picker —
   * a cancel is not a failure. Routes have their own sheet and do not go
   * through here; this is the recording's copy of that verb.
   */
  exportFile?: (format: ExportFormat) => Promise<string | null>;
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

/**
 * A drawn route. Unlike every other asset here it is a SYNCED record, not a
 * file on this device, so deleting it deletes it everywhere — which the confirm
 * has to say plainly.
 *
 * A route arriving through a canyon share is read-only: the API refuses the
 * write, so the UI must not offer it.
 */
export function routeActions(route: MirrorRoute): AssetActions {
  const readOnly = route.syncRole === "shared";
  return {
    locatable: route.points.length > 0,
    resolveBbox: async () =>
      bboxOfPoints(route.points.map(([lon, lat]) => ({ lon, lat }))),
    rename: readOnly
      ? async () => undefined
      : (name) => updateRouteLocal(route.id, { name }),
    ...(readOnly
      ? {}
      : {
          editableRouteId: route.id,
          setColor: (color: string) => updateRouteLocal(route.id, { color }),
          reverse: () =>
            updateRouteLocal(route.id, {
              points: reverseRoute(route.points),
              // Anchors are indices INTO points, so they have to be remapped
              // or the user's own vertices land on arbitrary snapped ones. A
              // route with none (an import) stays without: an empty list is
              // not a valid anchor set, it is the absence of one.
              ...(route.anchors
                ? {
                    anchors: reverseRouteAnchors(
                      route.anchors,
                      route.points.length,
                    ),
                  }
                : {}),
            }),
        }),
    delete: {
      confirmTitle: "Delete route?",
      confirmBody:
        "The route is removed from every device on your account. This can't be undone.",
      run: () => deleteRouteLocal(route.id),
    },
  };
}

export function trackActions(track: Track): AssetActions {
  return {
    locatable: track.pointCount > 0,
    // A track's extent isn't stored; derive it from its points on demand.
    resolveBbox: async () => bboxOfPoints(await listTrackPoints(track.id)),
    rename: (name) => updateTrack(track.id, { name }),
    // A recording is an observation and stays immutable; this makes a SEPARATE
    // route from it, which is the editable thing. Both exist afterwards.
    ...(track.pointCount >= MIN_ROUTE_POINTS
      ? {
          createRouteFrom: async () => {
            const fixes = await listTrackPoints(track.id);
            const { points } = simplifyToFit(
              fixes.map(({ lon, lat }): RoutePoint => [lon, lat]),
            );
            const name = `${track.name} (route)`.slice(0, ROUTE_NAME_MAX_LENGTH);
            // No anchors: every vertex came from RDP, not from a finger, so
            // there is no "the user placed these" subset to record.
            await createRouteLocal({ name, points });
            return { name, pointCount: points.length };
          },
        }
      : {}),
    // Exported from the STORED fixes, not the cached stats: the file is the
    // recording, gaps and timestamps included, with nothing simplified away.
    // Unlike createRouteFrom this needs no minimum — a one-point GPX is a
    // legal, if dull, file.
    ...(track.pointCount > 0
      ? {
          exportFile: async (format: ExportFormat) =>
            exportTrack(
              { name: track.name, points: await listTrackPoints(track.id) },
              format,
            ),
        }
      : {}),
    delete: {
      confirmTitle: "Delete track?",
      confirmBody: "The recorded points are deleted. This can't be undone.",
      run: () => deleteTrack(track.id),
    },
  };
}
