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
//   canyons/AddWaySheet.tsx        — a canyon's route slot, which renders a
//                                    TRACK's createRouteFrom and an IMPORT's
//                                    attachToCanyon from the canyon's side
//   saved/SavedScreen.tsx          — regions, GeoPDFs and LiDAR overlays (its
//                                    inline sheet). These are the kinds with
//                                    no map tap surface of their own;
//                                    everything that CAN be tapped on the map
//                                    has one sheet, above.
//
// A verb whose panel needs a surface (Share, Send a copy, "Attach to a canyon")
// is rendered INSIDE the sheet that owns the verb, never handed to the caller
// as a callback: a callback is only as good as the caller that remembers to
// pass it, which is the same asymmetry in a different shape. The canyon picker
// behind the last of those is `canyons/useCanyonPicker.tsx`, a sub-mode of the
// route, track and import sheets alike.
//
// Regions and topo overlays are NOT here: they are registry artifacts with no
// per-item row in the layer sheet, and their verbs stay inline in SavedScreen.
import { deleteGeoPdfImport } from "../geopdf/importPipeline";
import { updateGeoPdfImport, type GeoPdfImport } from "../geopdf/geoPdfImportsDb";
import { type VectorImport } from "../imports/importsDb";
import { deleteVectorImport } from "../imports/vectorImports";
import {
  deleteMediaLocal,
  linkStandaloneMediaLocal,
  renameStandaloneMediaLocal,
} from "../sync/mediaUpload";
import { getMediaById, type MirrorMedia } from "../sync/mirrorStore";
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
  MEDIA_EXTENSION_BY_MIME,
  MIN_ROUTE_POINTS,
  ROUTE_NAME_MAX_LENGTH,
  TRACK_MIME_TYPES,
  exportFilename,
  trackPointsToGpx,
  simplifyToFit,
  type RoutePoint,
} from "@logjam/shared";
import type { MirrorRoute, MirrorWaypoint } from "../sync/mirrorStore";
import { exportStoredFile, exportTrack } from "../fileExport";
import { attachMediaLocal } from "../sync/mediaUpload";
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
  "Shared with you — view and export, but not edit.";

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
  /** Change the asset's display colour. */
  setColor?: (color: string) => Promise<unknown>;
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
   * Turn a recording into an editable route. Non-destructive — the recording
   * is untouched — and simplifying is unavoidable: a real recording is
   * thousands of fixes and the cap is MAX_ROUTE_POINTS. Resolves with the
   * point count kept so the caller can say what happened.
   *
   * `canyonId` fills that canyon's route slot in the SAME write: the track
   * itself is an immutable observation and is never linked to anything, so
   * "attach this recording to a canyon" is this verb with a destination.
   * Creating and then updating would leave a window where the route exists
   * unlinked, and a failed second write would strand it there.
   */
  createRouteFrom?: (canyonId?: string) => Promise<{ name: string; pointCount: number }>;
  /**
   * Fill a canyon's route slot with a COPY of this asset's stored original.
   *
   * A COPY, and nothing in Saved changes: imports are device-local and never
   * sync, while a canyon route attachment is synced media — which is the only
   * reason a sharee sees one at all. So the file is uploaded against the canyon
   * and the import row stays exactly as it was.
   *
   * Present only where there IS an original and it is a .gpx/.kml: a canyon
   * route attachment is TRACK media and the API takes nothing else. An import
   * is always one of those, so the verb is now unconditional on imports — it
   * LINKS the file rather than uploading a copy of it, which is also why it no
   * longer needs a retained original to work from.
   */
  attachToCanyon?: (canyonId: string) => Promise<unknown>;
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

/** The bytes an "Export as GeoJSON" would ship, or null if none are here. */
function geoJsonSource(
  imported: VectorImport,
  sourceFormat: "gpx" | "kml" | "geojson" | null,
): string | null {
  if (sourceFormat === "geojson" && imported.sourcePath) return imported.sourcePath;
  return imported.path;
}

export function vectorImportActions(imported: VectorImport): AssetActions {
  const sourceFormat = sourceFormatOf(imported);
  // Derived from the extension table rather than restated: two lists that must
  // agree are one declaration (mobile CLAUDE.md). GeoJSON now IS in
  // TRACK_MIME_TYPES — a canyon's way may be any of the three formats an import
  // can be — so the only thing that withholds the verb here is having no
  // original to attach.
  const trackMimeType = TRACK_MIME_TYPES.find(
    (mime) => MEDIA_EXTENSION_BY_MIME[mime] === sourceFormat,
  );
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
    // Renaming an import is a change to the FILE, not to this phone's view of
    // it, so it goes through the media row and reaches every device.
    rename: (name) => renameStandaloneMediaLocal(imported.id, name),
    exports: [
      ...originalRow,
      // A GeoJSON source ships its own bytes; anything else ships the derived
      // collection, which is all the GeoJSON there is. Withheld entirely when
      // NEITHER is on this phone — a file that synced as a row but has not been
      // downloaded here has nothing to export, and the row that can only fail
      // is absent rather than offered (DESIGN.md §7).
      ...geoJsonSource(imported, sourceFormat)
        ? [
            {
              title: "Export as GeoJSON",
              run: () =>
                exportStoredFile(
                  geoJsonSource(imported, sourceFormat)!,
                  exportFilename(imported.name, "geojson", "import"),
                ),
            },
          ]
        : [],
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
    // Attaching LINKS this file to the canyon; it does not upload a copy of it.
    // The import stays in Saved, keeps its identity, and survives both being
    // replaced and the canyon being deleted — which is why the promise the
    // panel makes could change from "a copy of the file is attached" to what it
    // says now (routeSlot.ts, IMPORT_TO_CANYON_PROMISE).
    attachToCanyon: (canyonId: string) =>
      linkStandaloneMediaLocal(imported.id, canyonId),
    delete: {
      confirmTitle: "Delete this import?",
      // Imports sync now, so this is not a local tidy-up: it removes the file
      // from the account and therefore from every device. The old copy said
      // "removed from the device", which after sync would have been a lie.
      confirmBody:
        "This deletes the file from your account, so it goes from Logjam Web and your other devices too.",
      run: () => deleteVectorImport(imported.id),
    },
  };
}

/**
 * A recording made on ANOTHER device: a standalone media row with no local
 * track behind it, so there are no points here to fly to, resume, or export.
 *
 * A deliberately thin descriptor. Everything a recording can do on the phone
 * that made it needs its point series, and downloading a GPX to rebuild one is
 * a feature nobody has asked for — what this row is for is knowing the trip is
 * safe, being able to name it, and being able to get rid of it.
 */
export function remoteTrackActions(file: MirrorMedia): AssetActions {
  const bbox = file.metadata.bbox ?? null;
  return {
    locatable: bbox !== null,
    resolveBbox: async () => bbox,
    rename: (name) => renameStandaloneMediaLocal(file.id, name),
    delete: {
      confirmTitle: "Delete this recording?",
      confirmBody:
        "This deletes it from your account, so it goes from Logjam Web and the phone that recorded it too.",
      run: () => deleteMediaLocal(file),
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
    // edit and delete are all ABSENT rather than present and refused (see
    // AssetActions.delete). Direction and colour are not verbs here at all —
    // they are controls in the draw tool, reached through `editableRouteId`,
    // and they act on the DRAFT so the open editor and the stored route can
    // never disagree.
    ...(readOnly
      ? {}
      : {
          rename: (name: string) => updateRouteLocal(route.id, { name }),
          editableRouteId: route.id,
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
              "The waypoint is removed from every device on your account and from anyone you shared it with. This can't be undone.",
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
    setColor: (color: string) => updateTrack(track.id, { color }),
    // A recording is an observation and stays immutable; this makes a SEPARATE
    // route from it, which is the editable thing. Both exist afterwards.
    ...(track.pointCount >= MIN_ROUTE_POINTS
      ? {
          createRouteFrom: async (canyonId?: string) => {
            const fixes = await listTrackPoints(track.id);
            const { points } = simplifyToFit(
              fixes.map(({ lon, lat }): RoutePoint => [lon, lat]),
            );
            const name = `${track.name} (route)`.slice(0, ROUTE_NAME_MAX_LENGTH);
            // No anchors: every vertex came from RDP, not from a finger, so
            // there is no "the user placed these" subset to record.
            await createRouteLocal({
              name,
              points,
              color: track.color,
              ...(canyonId ? { canyonId } : {}),
            });
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
      // A finished recording is backed up to the account as a file, so deleting
      // it here is not a local tidy-up any more — leaving the backup behind
      // would put the same trip straight back in this list as a
      // recorded-elsewhere row, which reads as the delete having failed.
      confirmBody:
        "The recorded points and the backup in your account are both deleted. This can't be undone.",
      run: () => deleteRecordedTrack(track),
    },
  };
}

/**
 * Delete a recording and its backup together.
 *
 * Order matters: the media row goes FIRST. If that fails the local track
 * survives with its `mediaId` intact and the delete can be retried; the other
 * way round loses the points and leaves an orphan file in the account that
 * nothing on this phone still points at.
 */
async function deleteRecordedTrack(track: Track): Promise<void> {
  if (track.mediaId) {
    const backup = await getMediaById(track.mediaId);
    if (backup) await deleteMediaLocal(backup);
  }
  await deleteTrack(track.id);
}
