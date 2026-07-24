// Notifications offline cache (stage8-sync.md §4.7): notifications are
// deliberately NOT in the delta protocol — they're refetch-and-cache. The
// last GET /notifications response is stored verbatim so the inbox renders
// offline; a live fetch refreshes it and the cache follows.
//
// PRIVACY: notification payloads carry canyon references (ids only by the
// push-payload rule, but titles/names may appear) — app-private, behind the
// app lock, never logged.
import type { TNotification } from "../api/types";
import { getNotifications } from "../api/queries";
import { getSyncDb, notifyMirrorChanged } from "./syncDb";

export type NotificationsCache = {
  notifications: TNotification[];
  total: number | null;
  fetchedAt: string;
};

async function writeCache(
  notifications: TNotification[],
  total: number | null,
): Promise<void> {
  const db = await getSyncDb();
  // Single-row cache: replace wholesale.
  await db.runAsync("DELETE FROM notifications_cache");
  await db.runAsync(
    "INSERT INTO notifications_cache (fetched_at, payload_json) VALUES (?, ?)",
    new Date().toISOString(),
    JSON.stringify({ notifications, total }),
  );
}

export async function readNotificationsCache(): Promise<NotificationsCache | null> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<{ fetched_at: string; payload_json: string }>(
    "SELECT fetched_at, payload_json FROM notifications_cache LIMIT 1",
  );
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload_json) as {
      notifications: TNotification[];
      total: number | null;
    };
    return {
      notifications: parsed.notifications,
      total: parsed.total,
      fetchedAt: row.fetched_at,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch notifications and refresh the offline cache. Throws on network
 * failure (the caller falls back to readNotificationsCache) — a failed
 * fetch must NOT wipe a good cache.
 */
export async function fetchAndCacheNotifications(): Promise<NotificationsCache> {
  const { data, total } = await getNotifications();
  await writeCache(data, total);
  return { notifications: data, total, fetchedAt: new Date().toISOString() };
}

/** Unread count derived from the cache — drives the inbox tab badge so it
 * drops immediately on a (possibly offline) mark-read and stays correct
 * offline. Null when no cache exists yet (first launch, inbox never opened);
 * callers fall back to the server count then. */
export async function getCachedUnreadCount(): Promise<number | null> {
  const cache = await readNotificationsCache();
  if (!cache) return null;
  return cache.notifications.filter((notification) => !notification.read).length;
}

/** Optimistically flip cached read flags so the inbox reflects a mark-read
 * before the next fetch (keeps offline reads consistent with the action).
 * `ids === "all"` marks everything read. */
export async function patchCachedRead(ids: string[] | "all"): Promise<void> {
  const cache = await readNotificationsCache();
  if (!cache) return;
  const idSet = ids === "all" ? null : new Set(ids);
  const next = cache.notifications.map((notification) =>
    idSet === null || idSet.has(notification.id)
      ? { ...notification, read: true }
      : notification,
  );
  await writeCache(next, cache.total);
  notifyMirrorChanged();
}
