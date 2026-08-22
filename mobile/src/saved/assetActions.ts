// The three verbs every saved asset supports — *show on map*, *rename*,
// *delete* — as one descriptor per kind (DESIGN.md §7: uniformity is the
// feature).
//
// This exists because SEVERAL surfaces offer them, and two copies of "what does
// Delete mean for a GeoPDF" is how the wording on one of them goes stale.
//
// THE RENDER SITES, all of which must be checked when a verb is added here —
// this list said "TWO places" until 2026-08-22, and a Share verb wired into
// only the first one shipped invisible: routes in Saved open
// RouteOptionsSheet, not SavedScreen's inline sheet, so every test passed
// while the button did not exist in the running app.
//
//   routes/RouteOptionsSheet.tsx   — routes,   from BOTH Saved and the map
//   tracks/TrackOptionsSheet.tsx   — tracks,   from BOTH Saved and the map
//   imports/ImportOptionsSheet.tsx — imports,  from BOTH Saved and the map
//   map/WaypointSheet.tsx          — waypoints, from BOTH Saved and the map
//   saved/SavedScreen.tsx          — regions, GeoPDFs and LiDAR overlays (its
//                                    inline sheet). These are the kinds with
//                                    no map tap surface of their own;
//                                    everything that CAN be tapped on the map
//                                    has one sheet, above.
//
// A verb whose panel needs a surface (Share, Send a copy) is rendered INSIDE
// the sheet that owns the verb, never handed to the caller as a callback: a
// callback is only as good as the caller that remembers to pass it, which is
// the same asymmetry in a different shape.
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
  type FileSendSourceKind,
  type SharableEntityType,
  MIN_ROUTE_POINTS,
  ROUTE_NAME_MAX_LENGTH,
  exportFilename,
  trackPointsToGpx,
  reverseRoute,
  reverseRouteAnchors,
  simplifyToFit,
  type RoutePoint,
} from "@logjam/shared";
import type { MirrorRoute, MirrorWaypoint } from "../sync/mirrorStore";
import { exportStoredFile, exportTrack } from "../fileExport";
import { bboxOfPoints, type Bbox } from "./bboxOfPoints";
// Narrow imports rather than the namespace: this module is pure descriptors
// and the only filesystem work in it is the track scratch file below.
import { deleteAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { scratchFileUri } from "../offline/localStores";

/**
 * Why a shared asset's write verbs are missing, in one sentence — five
 * surfaces say it, and the ownership rule is not something any two of them
 * should word differently (DESIGN.md §7).
 *
 * It does NOT name a canyon any more. It used to read "shared with you through
 * a canyon", which was true while a canyon share was the only way someone
 * else's row could reach this phone; direct `/shares` means a route, waypoint
 * or LiDAR topo now arrives with no canyon involved at all, and the sentence
 * was stating a false reason on the two surfaces that showed it most. Export
 * is named because a sharee genuinely can, and the copy that said only "view"
 * undersold what they were given.
 */
export const SHARED_READ_ONLY_HINT =
  "Shared with you — you can view and export it, but only its owner can change it.";

export type AssetActions = {
  /**
   * Someone else owns this — the reason every write verb below is absent, and
   * the flag the surfaces render `SHARED_READ_ONLY_HINT` on.
   *
   * An EXPLICIT statement rather than the proxy the screens used to read (`no
   * delete descriptor` = shared). The proxy only held for kinds whose delete
   * is the owner's: a LiDAR topo shared with you is a file on this handset, so
   * it keeps its delete, fell through the test, and lost its Share verb with
   * nothing on screen saying why.
   */
  sharedWithYou?: true;
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
   * Ways to write this asset out as a file the user keeps, in menu order.
   *
   * A LIST rather than the old `(format: ExportFormat) => …`, because the two
   * kinds that offer it no longer agree on what the choices are: a recording
   * serialises to GPX or KML, while an import hands back the ORIGINAL file it
   * was made from (whatever format that was) plus its derived GeoJSON. The
   * surfaces render whatever is here, so neither has to know which kind it is
   * looking at.
   *
   * Each `run` resolves with the filename written, or NULL when the user backed
   * out of the folder picker — a cancel is not a failure. Routes have their own
   * sheet and do not go through here.
   */
  exports?: { title: string; run: () => Promise<string | null> }[];
  /**
   * The item this asset IS, for the share sheet — present only when the user
   * owns it, absent on anything shared with them (the API refuses, so offering
   * the verb would be a lie, exactly as with `delete` and `rename`).
   *
   * Identity rather than a callback, for the same reason `editableRouteId` is:
   * opening a picker is navigation, and navigation lives with the screen. The
   * two IDs together are what `/shares` needs.
   *
   * Only for kinds the API can share — a device-local file (import, GeoPDF
   * import, region) has nothing on the server to grant access TO, and gets
   * "Send a copy" instead, which is a different and non-revocable promise.
   */
  share?: { entityType: SharableEntityType; entityId: string };
  /**
   * Hand this asset to a friend as a FILE, for the kinds that have no server
   * record to grant access to. A different promise from `share` and not a
   * weaker version of it: the recipient keeps the copy, can edit it, and the
   * sender cannot take it back. The two verbs sit next to each other in the
   * same sheet, so neither may borrow the other's words.
   *
   * `resolveFile` yields a file:// URI to upload. A track has no file on disk
   * — it is serialised on demand — so the temporary it writes comes back with
   * a `cleanup`; an import's stored original does not, and must not be
   * deleted.
   */
  sendCopy?: {
    sourceKind: FileSendSourceKind;
    /** What the recipient sees, extension included. */
    filename: string;
    resolveFile: () => Promise<{ uri: string; cleanup?: () => Promise<void> }>;
  };
};

export function geoPdfActions(geoPdf: GeoPdfImport): AssetActions {
  return {
    locatable: geoPdf.bbox != null,
    resolveBbox: async () => geoPdf.bbox,
    rename: (name) => updateGeoPdfImport(geoPdf.id, { label: name }),
    // The source PDF, not the MBTiles rendered from it: the recipient's own
    // import re-derives tiles on their device, and a tile pyramid is not a
    // thing another app can open. Only once the import finished — a
    // half-written source.pdf is not a file to hand anyone.
    ...(geoPdf.state === "ready"
      ? {
          sendCopy: {
            sourceKind: "import" as const,
            filename: exportFilename(geoPdf.label, "pdf", "import"),
            resolveFile: async () => ({
              uri: `file://${geoPdf.dirPath}/source.pdf`,
            }),
          },
        }
      : {}),
    delete: {
      confirmTitle: "Delete this GeoPDF?",
      confirmBody: "The imported map and its tiles are removed from the device.",
      run: () => deleteGeoPdfImport(geoPdf.id),
    },
  };
}

/** Extension of the file the user picked, or null on a row with no original. */
function sourceFormatOf(imported: VectorImport): "gpx" | "kml" | "geojson" | null {
  const lower = imported.sourcePath?.toLowerCase();
  if (!lower) return null;
  if (lower.endsWith(".gpx")) return "gpx";
  if (lower.endsWith(".kml")) return "kml";
  return "geojson";
}

export function vectorImportActions(imported: VectorImport): AssetActions {
  const sourceFormat = sourceFormatOf(imported);
  // The original, when it is not already GeoJSON. A GeoJSON source collapses
  // into the row below rather than offering the same file twice under two
  // names — and it is the ORIGINAL that survives the collapse, since the
  // derived collection is a re-serialisation of it.
  const originalRow =
    imported.sourcePath && sourceFormat && sourceFormat !== "geojson"
      ? [
          {
            title: `Export original (${sourceFormat.toUpperCase()})`,
            run: () =>
              exportStoredFile(
                imported.sourcePath!,
                exportFilename(imported.name, sourceFormat, "import"),
              ),
          },
        ]
      : [];
  return {
    locatable: true,
    resolveBbox: async () => imported.bbox,
    rename: (name) => renameVectorImport(imported.id, name),
    exports: [
      ...originalRow,
      {
        title: "Export as GeoJSON",
        run: () =>
          exportStoredFile(
            // A GeoJSON source ships its own bytes; anything else ships the
            // derived collection, which is all the GeoJSON there is.
            sourceFormat === "geojson" && imported.sourcePath
              ? imported.sourcePath
              : imported.path,
            exportFilename(imported.name, "geojson", "import"),
          ),
      },
    ],
    // The ORIGINAL bytes, never the derived GeoJSON — the derivation is lossy
    // (shared/src/vectorImport.ts keeps only `name` and `coordTimes`), which is
    // the whole reason originals are kept. A row with no original predates that
    // and can only offer what it has.
    ...(imported.sourcePath && sourceFormat
      ? {
          sendCopy: {
            sourceKind: "import" as const,
            filename: exportFilename(imported.name, sourceFormat, "import"),
            resolveFile: async () => ({ uri: `file://${imported.sourcePath}` }),
          },
        }
      : {}),
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
    ...(readOnly ? { sharedWithYou: true as const } : {}),
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
          share: { entityType: "route", entityId: route.id },
        }),
  };
}

export function waypointActions(waypoint: MirrorWaypoint): AssetActions {
  const readOnly = waypoint.syncRole === "shared";
  return {
    ...(readOnly ? { sharedWithYou: true as const } : {}),
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
          share: { entityType: "waypoint", entityId: waypoint.id },
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
          exports: (["gpx", "kml"] as const).map((format) => ({
            title: `Save as ${format.toUpperCase()}`,
            run: async () =>
              exportTrack(
                { name: track.name, points: await listTrackPoints(track.id) },
                format,
              ),
          })),
        }
      : {}),
    // Serialised on demand and NOT filed in the sender's own Imports tab: the
    // GPX exists for this send and nothing else. GPX rather than a choice,
    // because a recording's timestamps are the point and this is the format
    // that carries them everywhere.
    ...(track.pointCount > 0
      ? {
          sendCopy: {
            sourceKind: "track" as const,
            filename: exportFilename(track.name, "gpx", "track"),
            resolveFile: async () => {
              const points = await listTrackPoints(track.id);
              // SCRATCH_DIR, so the file joins the wipe: a serialised
              // recording is precise location history (offline/localStores.ts).
              const uri = await scratchFileUri(`send-${track.id}.gpx`);
              await writeAsStringAsync(uri, trackPointsToGpx(track.name, points));
              return {
                uri,
                cleanup: () => deleteAsync(uri, { idempotent: true }),
              };
            },
          },
        }
      : {}),
    delete: {
      confirmTitle: "Delete track?",
      confirmBody: "The recorded points are deleted. This can't be undone.",
      run: () => deleteTrack(track.id),
    },
  };
}
