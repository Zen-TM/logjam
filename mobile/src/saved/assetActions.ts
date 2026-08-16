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
  deleteWaypointLocal,
  updateRouteLocal,
  updateWaypointLocal,
} from "../sync/outbox";
import {
  MIN_ROUTE_POINTS,
  ROUTE_NAME_MAX_LENGTH,
  reverseRoute,
  reverseRouteAnchors,
  simplifyToFit,
  type RoutePoint,
} from "@logjam/shared";
import type { MirrorRoute, MirrorWaypoint } from "../sync/mirrorStore";
import { exportTrack, type ExportFormat } from "../fileExport";
import { bboxOfPoints, type Bbox } from "./bboxOfPoints";

/**
 * Why a shared asset's write verbs are missing, in one sentence — the map's
 * waypoint sheet and the Saved tab's overflow both say it, and the ownership
 * rule is not something two surfaces should word differently (DESIGN.md §7).
 */
export const SHARED_READ_ONLY_HINT =
  "Shared with you through a canyon — you can view it, but only its owner can change it.";

export type AssetActions = {
  /** False when the asset has no geographic extent to fly to. */
  locatable: boolean;
  /** Resolved on tap — a track's extent needs its points read back. */
  resolveBbox: () => Promise<Bbox | null>;
  /**
   * Display-only rename; resolution still keys off ids. ABSENT for the same
   * reason `delete` is: a shared route or waypoint is read-only, and the API
   * refuses the write. It used to be an `async () => undefined` stub, which
   * meant the surfaces offering Rename accepted the user's typing and threw it
   * away without a word.
   */
  rename?: (name: string) => Promise<unknown>;
  /**
   * ABSENT where the user may not delete this asset — today, a route or
   * waypoint shared with them through someone else's canyon. The API's delete
   * is owner-only (`requireOwnedRoute` / `requireWaypointOwner`), so offering
   * the verb removes the row from this phone, parks the push in the outbox as
   * `blocked`, and the next delta pull brings the row back: a destructive
   * action that fails loudly in Sync issues and quietly does nothing.
   *
   * Optional rather than a `readOnly` flag beside it, because the type is then
   * what stops a surface offering the verb — the map's waypoint sheet was the
   * only one of three that remembered the guard.
   */
  delete?: { confirmTitle: string; confirmBody: string; run: () => Promise<unknown> };
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
    // One gate for every write verb: a shared route is read-only, so rename,
    // edit, colour, reverse and delete are all ABSENT rather than present and
    // refused (see AssetActions.delete).
    ...(readOnly
      ? {}
      : {
          rename: (name: string) => updateRouteLocal(route.id, { name }),
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
          delete: {
            confirmTitle: "Delete route?",
            confirmBody:
              "The route is removed from every device on your account. This can't be undone.",
            run: () => deleteRouteLocal(route.id),
          },
        }),
  };
}

export function waypointActions(waypoint: MirrorWaypoint): AssetActions {
  const readOnly = waypoint.syncRole === "shared";
  return {
    locatable: true,
    // A point has no extent; the caller's camera treats a degenerate bbox as
    // "centre here", which is exactly what showing a waypoint means.
    resolveBbox: async () =>
      bboxOfPoints([{ lon: waypoint.longitude, lat: waypoint.latitude }]),
    // Same one gate as a route's: shared means every write verb is absent.
    ...(readOnly
      ? {}
      : {
          rename: (name: string) => updateWaypointLocal(waypoint.id, { name }),
          delete: {
            confirmTitle: "Delete waypoint?",
            confirmBody:
              "The waypoint is removed from every device on your account, and from anyone you shared its canyons with. This can't be undone.",
            run: () => deleteWaypointLocal(waypoint.id),
          },
        }),
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
