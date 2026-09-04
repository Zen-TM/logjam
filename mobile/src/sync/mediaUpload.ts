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
import * as FileSystem from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { getThumbnailAsync } from "expo-video-thumbnails";
import {
  categoryHasThumbnail,
  isUuidV4,
  mediaCategory,
  MEDIA_EXTENSION_BY_MIME,
  type MediaMetadata,
  type MediaOrigin,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import type { MirrorMedia } from "./mirrorStore";
import { getSyncDb, notifyMirrorChanged, withSyncTransaction } from "./syncDb";
import { scheduleMutationSync } from "./mediaSyncBridge";
import { MEDIA_CACHE_DIR as CACHE_DIR, WIPED_DIRS } from "../offline/localStores";
import { canRunNow } from "../offline/networkPolicy";
import { uploadToPresignedUrl } from "../api/presignedTransfer";

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
  linkedId: string | null;
  mediaType: string;
  filename: string | null;
  displayName: string | null;
  fileSizeBytes: number | string;
  color: string | null;
  origin: string | null;
  createdAt: string;
  updatedAt: string;
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

/**
 * MOT-005/D6: a picker/camera source is safe (and, since nothing else
 * declares or wipes it, necessary) to delete once `attachMediaLocal` has
 * copied it. A path under one of OUR declared stores is not that — it's an
 * asset whose lifecycle is governed elsewhere, e.g. a vector import's
 * `sourcePath` reused by `saved/assetActions.ts`'s "attach to canyon" (the
 * app's only kept original of a lossy GPX/KML derivation — see mobile/
 * CLAUDE.md "Imports keep their ORIGINAL BYTES"). `localStores.test.ts`
 * guarantees nothing outside `localStores.ts` names a filesystem root, so
 * anything NOT under one of these prefixes can only be a native module's own
 * cache path.
 */
function isOwnedStorePath(uri: string): boolean {
  return WIPED_DIRS.some((dir) => uri.startsWith(dir));
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
  let thumbPath: string | null = null;
  try {
    await FileSystem.copyAsync({ from: file.uri, to: displayPath });

    if (categoryHasThumbnail(category)) {
      // A video's thumbnail has to be extracted from a frame first —
      // ImageManipulator cannot read an mp4. The server REQUIRES a thumbnail
      // for every category that declares one, so this is not optional.
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

    // MOT-005/D6: the source has now been fully copied (display) and read
    // (thumbnail extraction, if any) — delete it unless it's a path this app
    // already owns the lifecycle of elsewhere (see isOwnedStorePath). A
    // picker/camera source left alive here lives outside every declared
    // store and outside the account-transition wipe until now.
    if (!isOwnedStorePath(file.uri)) {
      await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => {});
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
  } catch (err) {
    // Anything between the first copy and the committed row (a manipulator
    // failure, an unreadable video, a rejected insert) used to strand the
    // bytes on disk: nothing sweeps MEDIA_CACHE_DIR except the
    // account-transition wipe, so an orphaned full-res photo lived for the
    // life of the install.
    await FileSystem.deleteAsync(displayPath, { idempotent: true }).catch(() => {});
    if (thumbPath !== null) {
      await FileSystem.deleteAsync(thumbPath, { idempotent: true }).catch(() => {});
    }
    throw err;
  }
  notifyMirrorChanged();
  scheduleMutationSync();
  return mediaId;
}

/**
 * Register a file this account OWNS — an import the user brought in, or a track
 * they recorded — as a standalone media row, and queue its upload.
 *
 * Unlike `attachMediaLocal` this does NOT copy the file. The caller's path is
 * already inside one of our declared stores (localStores.ts), so a copy would
 * be a third identical file on the phone and a second thing to keep in step
 * with the row. The path becomes the row's cached blob directly.
 *
 * The colour is a LOCAL GUESS so the line draws before the upload finishes; the
 * server reassigns authoritatively at confirm (see finalizeConfirmed).
 */
export async function createStandaloneMediaLocal(args: {
  /** Scheme-less or file:// path inside an owned store. Not copied. */
  filePath: string;
  filename: string;
  mediaType: string;
  origin: MediaOrigin;
  displayName: string | null;
  metadata: MediaMetadata;
  color: string | null;
}): Promise<string> {
  const category = mediaCategory(args.mediaType);
  if (category === null) {
    throw new Error(`Unsupported media type for upload: ${args.mediaType}`);
  }
  const displayPath = args.filePath.startsWith("file://")
    ? args.filePath
    : `file://${args.filePath}`;
  if (!isOwnedStorePath(displayPath)) {
    // A path outside our stores has a lifecycle nobody here controls: the OS
    // can reclaim it, and the account wipe would never reach it. Copying it
    // would be the fix, and `attachMediaLocal` is the function that copies.
    throw new Error("A standalone file must already live in an owned store");
  }
  const mediaId = mintUuid();
  const sizeBytes = await fileSize(displayPath);
  const now = new Date().toISOString();

  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO media
         (id, linked_type, linked_id, media_type, filename, display_name,
          file_size_bytes, color, origin, metadata_json, created_at, updated_at,
          extra_json, sync_state, local_display_path, local_thumb_path)
       VALUES (?, 'none', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
               'pendingUpload', ?, NULL)`,
      mediaId,
      args.mediaType,
      args.filename,
      args.displayName,
      String(sizeBytes),
      args.color,
      args.origin,
      JSON.stringify(args.metadata),
      now,
      now,
      displayPath,
    );
    await db.runAsync(
      `INSERT INTO outbox
         (op_id, entity, op, entity_id, fields_json, state, attempts, created_at)
       VALUES (?, 'media', 'create', ?, ?, 'queued', 0, ?)`,
      mintUuid(),
      mediaId,
      JSON.stringify({
        linkedType: "none",
        linkedId: null,
        filename: args.filename,
        mediaType: args.mediaType,
        sizeBytes,
        origin: args.origin,
        displayName: args.displayName,
        metadata: args.metadata,
        localDisplayPath: displayPath,
        localThumbPath: null,
      } satisfies MediaFields),
      now,
    );
  });
  notifyMirrorChanged();
  scheduleMutationSync();
  return mediaId;
}

/**
 * Rename a standalone file. Optimistic: the label changes locally at once and
 * the op carries it to the server.
 *
 * Supersedes rather than queues: two renames of the same file are not two
 * facts, they are one label, and sending both would have the server briefly
 * hold a name the user already replaced.
 */
export async function renameStandaloneMediaLocal(
  mediaId: string,
  displayName: string | null,
): Promise<void> {
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    await db.runAsync(
      "UPDATE media SET display_name = ? WHERE id = ?",
      displayName,
      mediaId,
    );
    await db.runAsync(
      `DELETE FROM outbox
       WHERE entity = 'media' AND op = 'rename' AND entity_id = ?
         AND state = 'queued'`,
      mediaId,
    );
    await db.runAsync(
      `INSERT INTO outbox
         (op_id, entity, op, entity_id, fields_json, state, attempts, created_at)
       VALUES (?, 'media', 'rename', ?, ?, 'queued', 0, ?)`,
      mintUuid(),
      mediaId,
      JSON.stringify({ displayName } satisfies RenameFields),
      new Date().toISOString(),
    );
  });
  notifyMirrorChanged();
  scheduleMutationSync();
}

/**
 * Link a standalone file to a canyon as its way, or unlink it (`canyonId`
 * null). The mirror moves immediately; the op carries the move to the server.
 *
 * Supersedes a queued link for the same file for the same reason a rename does:
 * a file has one parent, and replaying the intermediate ones would make a
 * sharee's mirror flicker through canyons the user never left it on.
 */
export async function linkStandaloneMediaLocal(
  mediaId: string,
  canyonId: string | null,
): Promise<void> {
  const db = await getSyncDb();
  await withSyncTransaction(db, async () => {
    await db.runAsync(
      "UPDATE media SET linked_type = ?, linked_id = ? WHERE id = ?",
      canyonId === null ? "none" : "canyon",
      canyonId,
      mediaId,
    );
    await db.runAsync(
      `DELETE FROM outbox
       WHERE entity = 'media' AND op = 'link' AND entity_id = ?
         AND state = 'queued'`,
      mediaId,
    );
    await db.runAsync(
      `INSERT INTO outbox
         (op_id, entity, op, entity_id, fields_json, state, attempts, created_at)
       VALUES (?, 'media', 'link', ?, ?, 'queued', 0, ?)`,
      mintUuid(),
      mediaId,
      JSON.stringify({ canyonId } satisfies LinkFields),
      new Date().toISOString(),
    );
  });
  notifyMirrorChanged();
  scheduleMutationSync();
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
  linkedType: "canyon" | "tripLog" | "none";
  /** Null on a standalone file — it belongs to no canyon or trip. */
  linkedId: string | null;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  thumbnailSizeBytes?: number;
  localDisplayPath: string;
  localThumbPath: string | null;
  /** Standalone files only: what kind it is, and its row-level stats. */
  origin?: MediaOrigin;
  displayName?: string | null;
  metadata?: MediaMetadata;
};

/** Fields of a rename op (`op = 'rename'`). */
type RenameFields = { displayName: string | null };

/** Fields of a link/unlink op (`op = 'link'`). */
type LinkFields = { canyonId: string | null };

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
  // Guarded, not bare: `uploadAsync` has no timeout, so the Pixel-9
  // connect()-hang this helper exists for parked a media op forever with the
  // sync pump waiting on it (MAPP-006 — the finding fixed the Send-a-copy and
  // GeoPDF legs; these media legs are the same call on a sibling surface, and
  // mobile/CLAUDE.md's rule is that a second caller inherits the first's
  // guards). A first-byte timeout throws, so the op fails and retries like any
  // other transient error instead of hanging.
  const result = await uploadToPresignedUrl(url, fileUri, {
    "Content-Type": contentType,
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
  // The server owns the colour: it picks the next one avoiding collisions
  // across every device, which this phone cannot see. The local row carried a
  // guess so the line drew immediately, and this is where the two reconcile —
  // usually to the same value, since both run pickNextTrackColor over nearly
  // the same set.
  await db.runAsync(
    `UPDATE media SET sync_state = 'synced', color = ?, file_size_bytes = ?,
       media_type = ?, filename = ?, display_name = ?, updated_at = ?
     WHERE id = ?`,
    confirmed.color,
    String(confirmed.fileSizeBytes),
    confirmed.mediaType,
    confirmed.filename,
    confirmed.displayName,
    confirmed.updatedAt ?? null,
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
        ...linkBody(fields),
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

  // MOT-006: presign above is a few hundred bytes of JSON, fine on the
  // `sync` allowance it always rode; the PUTs below are the actual media
  // bytes (up to 30 MB an image, 500 MB a video) and answer to their own
  // metered gate instead. Not allowed right now is not a failure — undo
  // flush.ts's optimistic attempts bump and leave the op exactly where it
  // was, so it waits for Wi-Fi like every other large transfer instead of
  // burning through MEDIA_MAX_ATTEMPTS and parking as a Sync Issue.
  if (!(await canRunNow("mediaUpload"))) {
    await db.runAsync(
      "UPDATE outbox SET state = 'queued', attempts = ? WHERE seq = ?",
      row.attempts,
      row.seq,
    );
    return "blocked";
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
        ...linkBody(fields),
        filename: fields.filename,
        mediaType: fields.mediaType,
      },
    },
  );
  await finalizeConfirmed(db, row.seq, row.entity_id, confirmed);
  return "done";
}

/**
 * The parent (and, for a standalone file, its identity) as the API wants it.
 *
 * Spelled once because presign and confirm must agree exactly: they validate
 * the same pair and the same stats, and a body that differed between the two
 * would pass the fail-fast check and then 400 after the bytes were already up.
 * `linkedId` is OMITTED rather than sent as null on a standalone file — the
 * server rejects a "none" that carries one.
 */
function linkBody(fields: MediaFields): Record<string, unknown> {
  if (fields.linkedType !== "none") {
    return { linkedType: fields.linkedType, linkedId: fields.linkedId };
  }
  return {
    linkedType: "none",
    origin: fields.origin,
    displayName: fields.displayName ?? undefined,
    metadata: fields.metadata ?? {},
  };
}

/**
 * Rename a standalone file server-side. Idempotent: the row already carries the
 * new label locally, and PATCH is last-writer-wins, so a retry re-sends the
 * same value. A 404 means the file is gone — the goal state — and the op is
 * dropped rather than parked.
 */
export async function runMediaRenameOp(row: MediaOpRow): Promise<MediaOpOutcome> {
  const db = await getSyncDb();
  const fields = JSON.parse(row.fields_json ?? "{}") as RenameFields;
  try {
    await apiFetch<ConfirmedMedia>(`/media/${row.entity_id}`, {
      method: "PATCH",
      body: { displayName: fields.displayName },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err;
  }
  await db.runAsync("DELETE FROM outbox WHERE seq = ?", row.seq);
  return "done";
}

/**
 * Link a standalone file to a canyon as its way, or unlink it.
 *
 * This is what replaced uploading a COPY of an import into a canyon. The local
 * mirror row has already moved (the UI showed the change immediately), so a
 * success needs no further write; a 404 means the file is gone and the op has
 * nothing left to do. A 409 is the canyon's track slot being taken by
 * something this device has not pulled yet — a real conflict the user has to
 * see, so it parks rather than retrying forever.
 */
export async function runMediaLinkOp(row: MediaOpRow): Promise<MediaOpOutcome> {
  const db = await getSyncDb();
  const fields = JSON.parse(row.fields_json ?? "{}") as LinkFields;
  try {
    await apiFetch<ConfirmedMedia>(`/media/${row.entity_id}/link`, {
      method: "PATCH",
      body:
        fields.canyonId === null
          ? { linkedType: "none" }
          : { linkedType: "canyon", linkedId: fields.canyonId },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      await db.runAsync("DELETE FROM outbox WHERE seq = ?", row.seq);
      return "done";
    }
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
  await db.runAsync("DELETE FROM outbox WHERE seq = ?", row.seq);
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
  const cancelled = await withSyncTransaction(db, async () => {
    // Media ops bypass `planOutboxEnqueue`, so its delete-cancellation never
    // ran here: deleting a photo whose upload was still queued uploaded the
    // whole file (presign → PUT → confirm, possibly on metered data) and then
    // deleted it server-side again. Same "never sent" test the planner uses —
    // queued, no attempt, no phase started — and the server has nothing to
    // delete, so the local row and its blobs go straight away.
    const pendingCreate = await db.getFirstAsync<{ seq: number }>(
      `SELECT seq FROM outbox
       WHERE entity = 'media' AND op = 'create' AND entity_id = ?
         AND state = 'queued' AND attempts = 0 AND media_phase IS NULL`,
      media.id,
    );
    if (pendingCreate) {
      await db.runAsync("DELETE FROM outbox WHERE seq = ?", pendingCreate.seq);
      await db.runAsync("DELETE FROM media WHERE id = ?", media.id);
      return true;
    }

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
    return false;
  });
  if (cancelled) {
    for (const path of [media.localDisplayPath, media.localThumbPath]) {
      if (path) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    }
  }
  notifyMirrorChanged();
  scheduleMutationSync();
}
