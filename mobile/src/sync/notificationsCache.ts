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
  // EVERY write announces itself, the fetch included. The patches used to
  // notify individually and the fetch did not, so a refresh that brought back a
  // different read state updated the list and left the tab badge on the old
  // number — AppShell recomputes the badge from this cache, and only on this
  // signal. One notify beside the one write is what keeps the two agreeing.
  notifyMirrorChanged();
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
 * The inbox mutations this device has made but not yet pushed, read straight
 * off the outbox (the table, not the module — importing `outbox.ts` here would
 * close a cycle through `syncDb`).
 *
 * `GET /notifications` is the authority on `read` and on which rows exist, so
 * a fetch that ignored the queue would undo every pending change the moment it
 * landed: a marked-read row would go back to saying New (the race that already
 * forced `patchCachedPayload` to exist), and a row deleted offline would come
 * back from the dead on the next pull-to-refresh. Replaying the queue over the
 * response is what makes the fetch agree with the screen; the ops themselves
 * then settle it server-side.
 *
 * `deadRemote` ops are skipped — the server row is gone, so they are no longer
 * a statement about anything.
 */
async function pendingInboxOps(): Promise<{
  deleted: Set<string>;
  read: Map<string, boolean>;
}> {
  const db = await getSyncDb();
  const rows = await db.getAllAsync<{ op: string; entity_id: string }>(
    `SELECT op, entity_id FROM outbox
     WHERE entity = 'notification' AND state != 'deadRemote' ORDER BY seq ASC`,
  );
  const deleted = new Set<string>();
  const read = new Map<string, boolean>();
  // In seq order, so the last op for a row wins — the same rule the server
  // applies when the queue eventually flushes.
  for (const row of rows) {
    if (row.op === "delete") deleted.add(row.entity_id);
    else if (row.op === "markRead") read.set(row.entity_id, true);
    else if (row.op === "markUnread") read.set(row.entity_id, false);
  }
  return { deleted, read };
}

/**
 * Fetch notifications and refresh the offline cache. Throws on network
 * failure (the caller falls back to readNotificationsCache) — a failed
 * fetch must NOT wipe a good cache.
 */
export async function fetchAndCacheNotifications(): Promise<NotificationsCache> {
  const { data, total } = await getNotifications();
  const pending = await pendingInboxOps();
  const notifications = data
    .filter((notification) => !pending.deleted.has(notification.id))
    .map((notification) => {
      const read = pending.read.get(notification.id);
      return read === undefined ? notification : { ...notification, read };
    });
  const stillDeleting = data.length - notifications.length;
  const adjustedTotal =
    total === null ? null : Math.max(notifications.length, total - stillDeleting);
  await writeCache(notifications, adjustedTotal);
  return {
    notifications,
    total: adjustedTotal,
    fetchedAt: new Date().toISOString(),
  };
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

/**
 * Optimistically merge fields into ONE cached notification's payload, so a row
 * the user just acted on restyles itself without a refetch.
 *
 * This exists because the refetch was the bug: `GET /notifications` is the
 * authority on `read`, so re-fetching immediately after a mark-read raced the
 * outbox push and wrote `read: false` back over it — the row the user had just
 * answered went on saying "New". Patching the one field we already know the
 * server will agree with (an accepted send is accepted) keeps the row in place,
 * keeps it read, and costs no request.
 */
export async function patchCachedPayload(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const cache = await readNotificationsCache();
  if (!cache) return;
  const next = cache.notifications.map((notification) =>
    notification.id === id
      ? { ...notification, payload: { ...notification.payload, ...patch } }
      : notification,
  );
  await writeCache(next, cache.total);
}

/** Optimistically flip cached read flags so the inbox reflects a mark-read (or
 * a mark-UNread) before the next fetch — which is also what keeps an offline
 * read consistent with the action. `ids === "all"` marks everything. */
export async function patchCachedRead(
  ids: string[] | "all",
  read = true,
): Promise<void> {
  const cache = await readNotificationsCache();
  if (!cache) return;
  const idSet = ids === "all" ? null : new Set(ids);
  const next = cache.notifications.map((notification) =>
    idSet === null || idSet.has(notification.id)
      ? { ...notification, read }
      : notification,
  );
  await writeCache(next, cache.total);
}

/**
 * Drop notifications from the cache, so a delete takes the row off screen at
 * once and STAYS off it offline — the queued delete op is what eventually tells
 * the server, and the next fetch after that agrees.
 *
 * `total` is decremented with them: it is the server's count of everything,
 * including rows past the list cap, and leaving it alone would make the
 * truncation arithmetic claim hidden rows that don't exist.
 */
export async function removeCachedNotifications(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const cache = await readNotificationsCache();
  if (!cache) return;
  const idSet = new Set(ids);
  const next = cache.notifications.filter(
    (notification) => !idSet.has(notification.id),
  );
  const removed = cache.notifications.length - next.length;
  await writeCache(
    next,
    cache.total === null ? null : Math.max(next.length, cache.total - removed),
  );
}
