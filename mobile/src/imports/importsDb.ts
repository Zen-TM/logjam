// An import, as this app sees it: the synced media row joined to what is true
// about it ON THIS PHONE.
//
// It used to be one device-only table. An import is now a standalone media row
// (`linked_type` "none", `origin` "import"), so its name, colour, extent and
// counts are server-authoritative and arrive by delta — which is what lets an
// import made on one device appear on another, and on Logjam Web. What stays
// here is only what could not be shared: whether it is drawn on THIS map, and
// where its bytes are on THIS disk.
//
// The join is done in JS because the two live in different SQLite files
// (logjam.db for the mirror, logjam-offline.db for device state) and there is
// no reason to merge them: both sides are tens of rows, and the wipes,
// versioning and app-lock posture of the two stores are deliberately separate.
//
// PRIVACY: imports are the user's own tracks — canyon-area coordinates. Rows,
// bboxes and paths never reach logs, telemetry or crash reports; having any
// import on disk arms the Stage 4 app lock (see AppLockGate).
import { mediaDisplayName, type MediaMetadata } from "@logjam/shared";

import { getOfflineDb } from "../offline/registryDb";
import {
  getMediaById,
  listStandaloneMedia,
  type MirrorMedia,
} from "../sync/mirrorStore";
import { onMirrorChanged } from "../sync/syncDb";

export type VectorImport = {
  /** The media id. One identity for the file, its row and its device state. */
  id: string;
  name: string;
  /** Line/point colour on the map (hex). Assigned server-side. */
  color: string;
  visible: boolean;
  /**
   * Absolute app-private path of the derived GeoJSON, scheme-less, or null
   * when this phone has not downloaded the file yet.
   *
   * Null is a NORMAL state, not a broken row: rows sync eagerly and bytes are
   * fetched on demand, so an import made on another device lists here with
   * nothing on disk until the user opens it or puts it on the map.
   */
  path: string | null;
  /**
   * Absolute app-private path of the file the user PICKED, scheme-less, or
   * null when it is not on this phone.
   *
   * Exists because `path`'s GeoJSON is a lossy derivation (see
   * shared/src/vectorImport.ts — only `name` and `coordTimes` survive), so it
   * is not what anyone should be handed back. The extension carries the source
   * format; nothing else records it.
   */
  sourcePath: string | null;
  /**
   * The friend who sent this copy, or null when the user imported it
   * themselves. Display only — a received copy is the recipient's own file.
   *
   * Device-local: the phone that accepted the send is the one that knows. It
   * does not follow the file to the user's other devices, which is a
   * deliberate limit rather than an omission — provenance is a note about how
   * a file arrived HERE.
   */
  sentBy: string | null;
  bbox: [number, number, number, number];
  featureCount: number;
  positionCount: number;
  sizeBytes: number;
  createdAt: string;
  /** True while the upload has not completed — the row exists only here so far. */
  pendingUpload: boolean;
};

type Listener = () => void;
const listeners = new Set<Listener>();
export function onImportsChanged(listener: Listener): () => void {
  listeners.add(listener);
  // The synced half changes without anything here being called — a delta pull
  // that brings in an import made on another phone, or a tombstone that takes
  // one away. Subscribing to both means a screen needs one subscription, not
  // two, and cannot forget the one that fires less often.
  const unsubscribeMirror = onMirrorChanged(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeMirror();
  };
}
export function notifyImportsChanged(): void {
  for (const listener of listeners) listener();
}

/** What this phone knows about one import, keyed by media id. */
export type ImportViewState = {
  mediaId: string;
  visible: boolean;
  path: string | null;
  sourcePath: string | null;
  sentBy: string | null;
};

type ViewStateRow = {
  mediaId: string;
  visible: number;
  path: string | null;
  sourcePath: string | null;
  sentBy: string | null;
};

const EMPTY_BBOX: [number, number, number, number] = [0, 0, 0, 0];

function bboxOf(metadata: MediaMetadata): [number, number, number, number] {
  // A row whose stats failed to parse still has a name, a size and a file. It
  // lists; it just cannot be flown to. `readMediaMetadata` already degraded it.
  return metadata.bbox ?? EMPTY_BBOX;
}

function join(media: MirrorMedia, view: ViewStateRow | undefined): VectorImport {
  return {
    id: media.id,
    name: mediaDisplayName(media),
    color: media.color ?? "#e6194b",
    visible: view ? view.visible !== 0 : true,
    path: view?.path ?? null,
    sourcePath: view?.sourcePath ?? null,
    sentBy: view?.sentBy ?? null,
    bbox: bboxOf(media.metadata),
    featureCount: media.metadata.featureCount ?? 0,
    positionCount: media.metadata.positionCount ?? 0,
    sizeBytes: media.fileSizeBytes ?? 0,
    createdAt: media.createdAt,
    pendingUpload: media.syncState === "pendingUpload",
  };
}

async function viewStatesById(): Promise<Map<string, ViewStateRow>> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<ViewStateRow>("SELECT * FROM import_view_state");
  return new Map(rows.map((row) => [row.mediaId, row]));
}

export async function listVectorImports(): Promise<VectorImport[]> {
  const [media, views] = await Promise.all([
    listStandaloneMedia("import"),
    viewStatesById(),
  ]);
  return media.map((row) => join(row, views.get(row.id)));
}

export async function getVectorImport(id: string): Promise<VectorImport | null> {
  const media = await getMediaById(id);
  if (!media || media.origin !== "import") return null;
  const db = await getOfflineDb();
  const view = await db.getFirstAsync<ViewStateRow>(
    "SELECT * FROM import_view_state WHERE mediaId = ?",
    id,
  );
  return join(media, view ?? undefined);
}

/**
 * Record where an import's bytes are on this phone. Called when it is first
 * imported here, and again when a file that arrived as a row is downloaded.
 */
export async function upsertImportViewState(state: ImportViewState): Promise<void> {
  const db = await getOfflineDb();
  await db.runAsync(
    `INSERT INTO import_view_state (mediaId, visible, path, sourcePath, sentBy)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(mediaId) DO UPDATE SET
       visible = excluded.visible,
       path = excluded.path,
       sourcePath = excluded.sourcePath,
       sentBy = excluded.sentBy`,
    state.mediaId,
    state.visible ? 1 : 0,
    state.path,
    state.sourcePath,
    state.sentBy,
  );
  notifyImportsChanged();
}

export async function setVectorImportVisible(
  id: string,
  visible: boolean,
): Promise<void> {
  const db = await getOfflineDb();
  // Upsert rather than update: a file that arrived from another device has no
  // row here until something writes one, and being toggled onto the map is
  // exactly such a something.
  await db.runAsync(
    `INSERT INTO import_view_state (mediaId, visible, path, sourcePath, sentBy)
     VALUES (?, ?, NULL, NULL, NULL)
     ON CONFLICT(mediaId) DO UPDATE SET visible = excluded.visible`,
    id,
    visible ? 1 : 0,
  );
  notifyImportsChanged();
}

/** Forget this phone's copy of an import. The media row is deleted separately
 *  (that half syncs); this is only the local state and the paths. */
export async function deleteImportViewState(
  id: string,
): Promise<ImportViewState | null> {
  const db = await getOfflineDb();
  const row = await db.getFirstAsync<ViewStateRow>(
    "SELECT * FROM import_view_state WHERE mediaId = ?",
    id,
  );
  await db.runAsync("DELETE FROM import_view_state WHERE mediaId = ?", id);
  notifyImportsChanged();
  if (!row) return null;
  return {
    mediaId: row.mediaId,
    visible: row.visible !== 0,
    path: row.path,
    sourcePath: row.sourcePath,
    sentBy: row.sentBy,
  };
}
