// Offline media cache (stage8-sync.md §7.3): delta media rows are metadata
// only — blobs come via POST /media/download-urls (presigned, short-lived,
// never persisted). Policy: thumbnails for everything visible are cached
// eagerly after each pull (small); full-res display files lazily on view.
//
// PRIVACY: cached blobs are canyon photos — app-private storage only
// (documentDirectory, covered by allowBackup=false), paths tracked in the
// mirror so tombstone apply deletes them with their rows.
import * as FileSystem from "expo-file-system/legacy";
import { downloadFromPresignedUrl } from "../api/presignedTransfer";
import { categoryHasThumbnail, mediaCategory } from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { getSyncDb, notifyMirrorChanged } from "./syncDb";
import { MEDIA_CACHE_DIR as CACHE_DIR } from "../offline/localStores";

const DOWNLOAD_URLS_BATCH = 100;

type DownloadUrlItem = {
  id: string;
  displayUrl: string;
  thumbnailUrl: string | null;
};

async function ensureCacheDir(): Promise<void> {
  await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(
    () => {},
  );
}

async function fetchDownloadUrls(ids: string[]): Promise<DownloadUrlItem[]> {
  const { items } = await apiFetch<{ items: DownloadUrlItem[] }>(
    "/media/download-urls",
    { method: "POST", body: { ids } },
  );
  return items;
}

/**
 * Media the server answered WITHOUT a thumbnail URL. Their row keeps
 * `local_thumb_path IS NULL` forever, so the eager pass re-selected them and
 * re-POSTed /media/download-urls after every successful pull — one avoidable
 * round trip per bad row per sync cycle, indefinitely, on the radio the
 * battery rules exist to protect. The lazy view fetch still covers them.
 *
 * ponytail: in-memory, so the first pass of each launch still asks once.
 * Persisting it means a mirror column and a MIRROR_SCHEMA_VERSION bump (which
 * drops and refetches every user's mirror) — not worth it for one request per
 * launch; do it if the row count ever makes that first pass expensive.
 */
const thumbnailMissing = new Set<string>();

/**
 * Eager thumbnail pass — called after each successful pull (best-effort;
 * failures leave rows uncached and the next pass retries). Only rows whose
 * MIME category carries a thumbnail are considered.
 */
export async function syncThumbnailCache(): Promise<void> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<{ id: string; media_type: string }>(
    `SELECT id, media_type FROM media
     WHERE sync_state = 'synced' AND local_thumb_path IS NULL`,
  );
  const wanted = rows.filter((row) => {
    if (thumbnailMissing.has(row.id)) return false;
    const category = mediaCategory(row.media_type);
    return category !== null && categoryHasThumbnail(category);
  });
  if (wanted.length === 0) return;

  await ensureCacheDir();
  let cachedAny = false;
  for (let i = 0; i < wanted.length; i += DOWNLOAD_URLS_BATCH) {
    const batch = wanted.slice(i, i + DOWNLOAD_URLS_BATCH);
    const items = await fetchDownloadUrls(batch.map((row) => row.id));
    for (const item of items) {
      if (!item.thumbnailUrl) {
        // Terminal: the server has decided this row has no thumbnail (a
        // pre-thumbnail legacy row, a category mismatch). Asking again cannot
        // change the answer.
        thumbnailMissing.add(item.id);
        continue;
      }
      const path = `${CACHE_DIR}${item.id}.thumb`;
      try {
        // downloadAsync writes the body regardless of HTTP status — an S3
        // error XML saved as a "thumbnail" poisons the cache, so gate on 200
        // and delete anything else.
        const result = await downloadFromPresignedUrl(item.thumbnailUrl, path);
        if (result.status !== 200) {
          await FileSystem.deleteAsync(path, { idempotent: true });
          continue;
        }
        await db.runAsync(
          "UPDATE media SET local_thumb_path = ? WHERE id = ?",
          path,
          item.id,
        );
        cachedAny = true;
      } catch {
        // Presign expired / network flake: retried on the next pass.
      }
    }
  }
  if (cachedAny) notifyMirrorChanged();
}

/**
 * Lazy full-res fetch on view (§7.3). Returns the local file URI, or null
 * when the blob isn't cached and can't be fetched (offline) — the caller
 * renders the thumbnail with an "available online" hint.
 */
export async function ensureDisplayCached(mediaId: string): Promise<string | null> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<{ local_display_path: string | null }>(
    "SELECT local_display_path FROM media WHERE id = ?",
    mediaId,
  );
  if (row?.local_display_path) {
    const info = await FileSystem.getInfoAsync(row.local_display_path);
    if (info.exists) return row.local_display_path;
  }
  try {
    const items = await fetchDownloadUrls([mediaId]);
    const item = items[0];
    if (!item) return null; // invisible/deleted server-side (omitted, §7.3)
    await ensureCacheDir();
    const path = `${CACHE_DIR}${mediaId}.display`;
    const result = await downloadFromPresignedUrl(item.displayUrl, path);
    if (result.status !== 200) {
      await FileSystem.deleteAsync(path, { idempotent: true });
      return null;
    }
    await db.runAsync(
      "UPDATE media SET local_display_path = ? WHERE id = ?",
      path,
      mediaId,
    );
    return path;
  } catch {
    return null;
  }
}
