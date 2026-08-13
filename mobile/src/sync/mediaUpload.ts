// Offline media capture → upload (stage8-sync.md §7.1). An "attach photo"
// copies the full-res image + a client-generated JPEG thumbnail into
// app-private storage, writes a pendingUpload mirror row, and enqueues one
// media.create outbox op. The flush engine (flush.ts) runs the three-phase
// presign → PUT → confirm flow as one resumable unit, parking on quota
// (507) / track-slot (409) races.
//
// PRIVACY: captured photos are canyon media — app-private media-cache/
// (allowBackup=false), never logged. The three-phase flow reuses the same
// authed endpoints + anti-oracle as the web client.
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { getThumbnailAsync } from "expo-video-thumbnails";
import {
  categoryHasThumbnail,
  isUuidV4,
  mediaCategory,
  MEDIA_EXTENSION_BY_MIME,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import type { MirrorMedia } from "./mirrorStore";
import { getSyncDb, notifyMirrorChanged, withSyncTransaction } from "./syncDb";
import { scheduleMutationSync } from "./mediaSyncBridge";

const CACHE_DIR = `${FileSystem.documentDirectory}media-cache/`;

// Client thumbnail contract (mirrors the web): a downscaled JPEG. The server
// only bounds thumbnailSizeBytes, not dimensions.
const THUMBNAIL_MAX_WIDTH = 400;
const THUMBNAIL_QUALITY = 0.7;
/** Frame to grab for a video thumbnail — 1s in, past any black lead-in. */
const VIDEO_THUMBNAIL_MS = 1000;

export type PickedFile = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
};

type PresignResponse = {
  mediaId: string;
  displayUploadUrl: string;
  thumbnailUploadUrl: string | null;
};

type ConfirmedMedia = {
  id: string;
  linkedType: string;
  linkedId: string;
  mediaType: string;
  filename: string | null;
  fileSizeBytes: number | string;
  color: string | null;
  createdAt: string;
};

async function ensureCacheDir(): Promise<void> {
  await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(
    () => {},
  );
}

async function fileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error("Captured file missing");
  return info.size ?? 0;
}

function mintUuid(): string {
  const id = Crypto.randomUUID();
  if (!isUuidV4(id)) throw new Error("UUID mint produced a non-v4 id");
  return id;
}

/**
 * Attach a picked/captured file to a canyon or trip: copy it (plus a generated
 * thumbnail where the category has one) into the app-private cache, write the
 * pendingUpload mirror row, and enqueue the media.create op. Returns the new
 * mediaId.
 *
 * Images get a downscaled JPEG thumbnail generated here. Track files
 * (GPX/KML) have no thumbnail at all — `categoryHasThumbnail` decides, the
 * presign mints no thumbnail URL for them, and the flush already treats a
 * missing thumbnail as normal. An unsupported MIME type throws rather than
 * uploading something the server will reject at confirm.
 */
export async function attachMediaLocal(
  linkedType: "canyon" | "tripLog",
  linkedId: string,
  file: PickedFile,
): Promise<string> {
  await ensureCacheDir();
  const mediaId = mintUuid();
  const mediaType = file.mimeType ?? "image/jpeg";
  const category = mediaCategory(mediaType);
  if (category === null) {
    throw new Error(`Unsupported media type for upload: ${mediaType}`);
  }
  const filename = file.fileName ?? `${mediaId}.${MEDIA_EXTENSION_BY_MIME[mediaType] ?? "bin"}`;

  const displayPath = `${CACHE_DIR}${mediaId}.display`;
  await FileSystem.copyAsync({ from: file.uri, to: displayPath });

  let thumbPath: string | null = null;
  if (categoryHasThumbnail(category)) {
    // A video's thumbnail has to be extracted from a frame first —
    // ImageManipulator cannot read an mp4. The server REQUIRES a thumbnail for
    // every category that declares one, so this is not optional.
    const stillUri =
      category === "video"
        ? (await getThumbnailAsync(file.uri, { time: VIDEO_THUMBNAIL_MS })).uri
        : file.uri;
    const thumb = await manipulateAsync(
      stillUri,
      [{ resize: { width: THUMBNAIL_MAX_WIDTH } }],
      { compress: THUMBNAIL_QUALITY, format: SaveFormat.JPEG },
    );
    thumbPath = `${CACHE_DIR}${mediaId}.thumb`;
    await FileSystem.copyAsync({ from: thumb.uri, to: thumbPath });
    await FileSystem.deleteAsync(thumb.uri, { idempotent: true }).catch(() => {});
    if (stillUri !== file.uri) {
      await FileSystem.deleteAsync(stillUri, { idempotent: true }).catch(() => {});
    }
  }

  const sizeBytes = await fileSize(displayPath);
  const thumbnailSizeBytes = thumbPath === null ? null : await fileSize(thumbPath);

  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO media
         (id, linked_type, linked_id, media_type, filename, file_size_bytes,
          color, created_at, extra_json, sync_state, local_display_path,
          local_thumb_path)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, 'pendingUpload', ?, ?)`,
      mediaId,
      linkedType,
      linkedId,
      mediaType,
      filename,
      String(sizeBytes),
      new Date().toISOString(),
      displayPath,
      thumbPath,
    );
    // Media ops never coalesce (immutable rows) — insert directly, not via
    // the shared enqueue planner (which is typed to push entities).
    await db.runAsync(
      `INSERT INTO outbox
         (op_id, entity, op, entity_id, fields_json, state, attempts, created_at)
       VALUES (?, 'media', 'create', ?, ?, 'queued', 0, ?)`,
      mintUuid(),
      mediaId,
      JSON.stringify({
        linkedType,
        linkedId,
        filename,
        mediaType,
        sizeBytes,
        ...(thumbnailSizeBytes != null && { thumbnailSizeBytes }),
        localDisplayPath: displayPath,
        localThumbPath: thumbPath,
      }),
      new Date().toISOString(),
    );
  });
  notifyMirrorChanged();
  scheduleMutationSync();
  return mediaId;
}

// ── flush-side: the three-phase resumable flow (§7.1) ───────────────────────

export type MediaOpRow = {
  seq: number;
  entity_id: string;
  op: string;
  fields_json: string | null;
  media_phase: string | null;
  /** Failed runs so far — the flush parks an op that keeps failing. */
  attempts: number;
};

/** Terminal outcome of running one media op. `blocked` = a quota/track-slot
 * race the user must resolve; a thrown error means network/5xx (the engine
 * backs off and retries the whole cycle). */
export type MediaOpOutcome = "done" | "blocked";

type MediaFields = {
  linkedType: "canyon" | "tripLog";
  linkedId: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  thumbnailSizeBytes?: number;
  localDisplayPath: string;
  localThumbPath: string | null;
};

/** The first of the op's local blobs that has gone missing, or null. */
async function firstMissingFile(fields: MediaFields): Promise<string | null> {
  for (const path of [fields.localDisplayPath, fields.localThumbPath]) {
    if (!path) continue;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return path;
  }
  return null;
}

async function putFile(
  url: string,
  fileUri: string,
  contentType: string,
): Promise<void> {
  const result = await FileSystem.uploadAsync(url, fileUri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": contentType },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed (${result.status})`);
  }
}

async function finalizeConfirmed(
  db: Awaited<ReturnType<typeof getSyncDb>>,
  seq: number,
  mediaId: string,
  confirmed: ConfirmedMedia,
): Promise<void> {
  // The uploaded local files become the offline cache blobs (§7.3).
  await db.runAsync(
    `UPDATE media SET sync_state = 'synced', color = ?, file_size_bytes = ?,
       media_type = ?, filename = ?
     WHERE id = ?`,
    confirmed.color,
    String(confirmed.fileSizeBytes),
    confirmed.mediaType,
    confirmed.filename,
    mediaId,
  );
  await db.runAsync("DELETE FROM outbox WHERE seq = ?", seq);
}

/**
 * Run a media.create op through presign → PUT → confirm. Idempotent: presign
 * with a client mediaId returns the finished row (200, no upload URLs) if the
 * flow already completed; PUTs re-run against the same server-derived keys;
 * confirm is idempotent server-side. `media_phase` records progress for
 * observability, but every step is safe to re-run.
 */
// Presign failures a retry can never fix: quota exhausted, track slot taken,
// payload too large, and outright validation/authorisation refusals. Anything
// else — 5xx, 429, 401, or a network error with no status at all — is
// transient and belongs in the backoff, not in the user's Sync Issues list.
const PERMANENT_PRESIGN_STATUSES = new Set([400, 403, 404, 409, 413, 422, 507]);

export async function runMediaCreateOp(row: MediaOpRow): Promise<MediaOpOutcome> {
  const db = await getSyncDb();
  const fields = JSON.parse(row.fields_json ?? "{}") as MediaFields;

  // Phase 0: the bytes still have to be here. If the OS reclaimed the cache
  // dir — or a sibling op's discard unlinked them — `uploadAsync` throws a
  // filesystem error with NO status, which no status classification can ever
  // call permanent, so the op retried forever without ever parking. It is a
  // terminal condition: park it where the user can see and discard it.
  const missing = await firstMissingFile(fields);
  if (missing) {
    await db.runAsync(
      "UPDATE outbox SET state = 'blocked', error_json = ? WHERE seq = ?",
      JSON.stringify({
        code: 0,
        message: "This file is no longer on this phone. Discard this upload.",
      }),
      row.seq,
    );
    return "blocked";
  }

  // Phase 1: presign. Quota (507) / track-slot (409) → park blocked.
  let presign: PresignResponse | ConfirmedMedia;
  try {
    presign = await apiFetch<PresignResponse | ConfirmedMedia>("/media/presign", {
      method: "POST",
      body: {
        mediaId: row.entity_id,
        linkedType: fields.linkedType,
        linkedId: fields.linkedId,
        filename: fields.filename,
        mediaType: fields.mediaType,
        sizeBytes: fields.sizeBytes,
        thumbnailSizeBytes: fields.thumbnailSizeBytes,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    // Park only what a retry can never fix; rethrow the rest for the engine's
    // backoff. The old test was `>= 400 && < 600 && !== 500`, which swept in
    // 502/503/504 (an API deploy), 429 (rate limit) and 401 (an expired
    // token) — so six photos attached in a canyon became six sync issues
    // needing six manual Retry taps the moment the user hit a mid-deploy API.
    // flush.ts classifies those same statuses as transient; this is the copy
    // that disagreed.
    if (typeof status === "number" && PERMANENT_PRESIGN_STATUSES.has(status)) {
      await db.runAsync(
        "UPDATE outbox SET state = 'blocked', error_json = ? WHERE seq = ?",
        JSON.stringify({ code: status, message: messageForBlock(status) }),
        row.seq,
      );
      return "blocked";
    }
    throw err;
  }

  // Replay: presign returned the confirmed row (200) — the flow already ran.
  if (!("displayUploadUrl" in presign)) {
    await finalizeConfirmed(db, row.seq, row.entity_id, presign);
    return "done";
  }

  // Phase 2: PUT display + thumbnail to S3 (no limiter cost).
  await putFile(presign.displayUploadUrl, fields.localDisplayPath, fields.mediaType);
  if (presign.thumbnailUploadUrl && fields.localThumbPath) {
    await putFile(presign.thumbnailUploadUrl, fields.localThumbPath, "image/jpeg");
  }
  await db.runAsync(
    "UPDATE outbox SET media_phase = 'uploaded' WHERE seq = ?",
    row.seq,
  );

  // Phase 3: confirm (idempotent) → canonical row.
  const confirmed = await apiFetch<ConfirmedMedia>(
    `/media/${row.entity_id}/confirm`,
    {
      method: "POST",
      body: {
        linkedType: fields.linkedType,
        linkedId: fields.linkedId,
        filename: fields.filename,
        mediaType: fields.mediaType,
      },
    },
  );
  await finalizeConfirmed(db, row.seq, row.entity_id, confirmed);
  return "done";
}

/** Delete a media row (idempotent: 404 → already gone). Removes the op, the
 * mirror row, and the cached blobs. */
export async function runMediaDeleteOp(row: MediaOpRow): Promise<MediaOpOutcome> {
  const db = await getSyncDb();
  try {
    await apiFetch<void>(`/media/${row.entity_id}`, { method: "DELETE" });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err; // 404 = goal state reached
  }
  const media = await db.getFirstAsync<{
    local_display_path: string | null;
    local_thumb_path: string | null;
  }>(
    "SELECT local_display_path, local_thumb_path FROM media WHERE id = ?",
    row.entity_id,
  );
  await db.runAsync("DELETE FROM media WHERE id = ?", row.entity_id);
  await db.runAsync("DELETE FROM outbox WHERE seq = ?", row.seq);
  for (const path of [media?.local_display_path, media?.local_thumb_path]) {
    if (path) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
  return "done";
}

function messageForBlock(status: number): string {
  if (status === 507) return "Not enough storage space. Free some space and retry.";
  if (status === 409) return "This canyon already has a track. Remove it first.";
  return "The server rejected this upload.";
}

/** Enqueue a media delete (used by the detail UI). */
export async function deleteMediaLocal(media: MirrorMedia): Promise<void> {
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    // Optimistic: hide the row immediately; the op reconciles server + blobs.
    await db.runAsync(
      "UPDATE media SET sync_state = 'pendingDelete' WHERE id = ?",
      media.id,
    );
    await db.runAsync(
      `INSERT INTO outbox
         (op_id, entity, op, entity_id, fields_json, state, attempts, created_at)
       VALUES (?, 'media', 'delete', ?, NULL, 'queued', 0, ?)`,
      mintUuid(),
      media.id,
      new Date().toISOString(),
    );
  });
  notifyMirrorChanged();
  scheduleMutationSync();
}
