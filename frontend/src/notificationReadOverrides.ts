import type { TNotification } from "@logjam/shared";

/**
 * Read state the user has just changed, shown before the server confirms it.
 *
 * Marking a row used to wait for the PATCH and then for a refetch of the whole
 * inbox before the row, the hero and the rail's badge changed — long enough to
 * read as lag. Logjam GPS patches its cache first for the same reason. An
 * override lives until a fetch agrees with it, or until its write fails.
 */
export type ReadOverrides = ReadonlyMap<string, boolean>;

export function withReadOverrides(notifications: TNotification[], overrides: ReadOverrides): TNotification[] {
  if (overrides.size === 0) return notifications;
  return notifications.map((n) => {
    const read = overrides.get(n.id);
    return read === undefined || read === n.read ? n : { ...n, read };
  });
}

/**
 * Drop the overrides a fetch has caught up with, or whose row it no longer
 * returns. One the fetch DISAGREES with stays: that fetch may have left before
 * the write landed (App refetches the inbox on its own, when a job finishes).
 */
export function settleReadOverrides(overrides: ReadOverrides, fetched: TNotification[]): ReadOverrides {
  if (overrides.size === 0) return overrides;
  const fetchedRead = new Map(fetched.map((n) => [n.id, n.read]));
  const pending = [...overrides].filter(([id, read]) => fetchedRead.has(id) && fetchedRead.get(id) !== read);
  return pending.length === overrides.size ? overrides : new Map(pending);
}
