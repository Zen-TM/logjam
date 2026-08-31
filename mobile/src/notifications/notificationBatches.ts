// COLLAPSING the notifications one bulk share created into a single expandable
// row.
//
// The problem: a friend who shares 23 things in one gesture used to put 23 rows
// in your inbox, and (before the server started batching the push) 23 buzzes in
// your pocket. The buzz is fixed at the source — one push per bulk action. The
// ROWS are fixed here, and deliberately NOT at the source.
//
// WHY NOT ONE AGGREGATE NOTIFICATION ROW SERVER-SIDE, which is the obvious fix:
//
//  1. A `file_sent` row is a QUESTION, not a report. It carries Accept and Turn
//     down and the filename, because nobody can answer "keep this?" without
//     knowing what is on offer. One row saying "bob sent you 8 files" deletes
//     the surface those answers live on.
//  2. A shared-item row is DROPPED at read time when its share is revoked
//     (PRIV-001/003) — the payload holds ids and the display strings resolve
//     from the live rows. One row holding 23 ids would have to partially
//     resolve, recount its own label, and delete itself at zero.
//
// Both stay true with per-item rows and a client-side collapse, and the whole
// cost is this file. The server's only part is stamping the same opaque
// `batchId` on every notification one action creates.
//
// SPLIT BATCHES ARE NORMAL. The inbox sorts unread-first, so reading three of a
// batch's rows moves them away from the other twenty; a filter or a search
// narrows it further. So a batch is gathered over the WHOLE list rather than
// from a run of adjacent rows, and it is the FIRST member in list order that
// stands for it — which keeps an unread batch where the unread rows are.
//
// Its own RN-free module, like `notificationActions.ts` and `tapTarget.ts`:
// mobile's vitest cannot parse React Native's Flow sources.
//
// PRIVACY: reads the same resolved payload the rows render. Usernames are
// server-resolved and username-only; no id reaches a label.
import type { TNotification } from "../api/types";

/**
 * Which verb's notifications these are — and the reason a batch is keyed on it
 * as well as on the `batchId`.
 *
 * One bulk action can create both kinds at once (Saved's All tab mixes rows
 * that can only be shared with rows that can only be copied), and the two
 * cannot share a row: one has Accept/Turn down under it and the other has
 * nothing to answer. So a mixed action shows as TWO grouped rows — "bob shared
 * 5 items" and "bob sent you 3 files" — which is also the honest description of
 * what happened.
 */
export type BatchGroup = "shares" | "files";

export type NotificationBatch = {
  /** `${batchId}:${group}` — the identity the expanded set is keyed on. */
  key: string;
  group: BatchGroup;
  /** Every member currently in the list, in list order. */
  items: TNotification[];
  /**
   * The member whose POSITION the header takes, and whose payload it reads for
   * the sender and the timestamp. It is not itself the header row — see
   * `batchHeaderRow`.
   */
  representative: TNotification;
  unreadCount: number;
  /** Resolved server-side; null when the sharer no longer resolves. */
  sender: string | null;
};

/**
 * The header is its OWN row, not one of the members wearing the group's words.
 *
 * It was the representative at first, and that quietly hid an item: expanding
 * "alice shared 2 items with you" listed only the OTHER one, because the row
 * that would have named the first was busy being the header. A synthetic id
 * gives the header a key of its own, so an expanded batch can list every member
 * underneath it and the group's own row can go on saying only the count.
 */
const BATCH_ROW_PREFIX = "batch:";

export function batchHeaderRow(batch: NotificationBatch): TNotification {
  return { ...batch.representative, id: `${BATCH_ROW_PREFIX}${batch.key}` };
}

/** The batch a header row stands for, or null for an ordinary notification. */
export function batchKeyFromRowId(id: string): string | null {
  return id.startsWith(BATCH_ROW_PREFIX)
    ? id.slice(BATCH_ROW_PREFIX.length)
    : null;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function groupOf(n: TNotification): BatchGroup | null {
  if (n.type === "file_sent") return "files";
  if (n.type === "item_shared" || n.type === "canyon_shared") return "shares";
  return null;
}

/**
 * The batch key of one notification, or null when it was not part of one.
 *
 * A notification with no `batchId` is an ordinary single row — every share made
 * one at a time, and every notification created before this feature existed.
 */
export function batchKeyOf(n: TNotification): string | null {
  const batchId = str(n.payload, "batchId");
  if (!batchId) return null;
  const group = groupOf(n);
  return group ? `${batchId}:${group}` : null;
}

/**
 * Gather the batches present in an already-filtered list.
 *
 * FILTERED, not the raw list: with the Unread bucket selected a batch's count
 * has to be the number of rows the user can actually see under it, or the
 * header promises twelve and expands to four.
 *
 * A batch of ONE is not a batch. It happens whenever a bulk share had a single
 * shareable item in it, or a filter has narrowed a real batch down to one row —
 * and a collapsed header over one row is strictly worse than the row.
 */
export function findNotificationBatches(
  notifications: TNotification[],
): Map<string, NotificationBatch> {
  const batches = new Map<string, NotificationBatch>();
  for (const notification of notifications) {
    const key = batchKeyOf(notification);
    if (!key) continue;
    const existing = batches.get(key);
    if (existing) {
      existing.items.push(notification);
      if (!notification.read) existing.unreadCount += 1;
      continue;
    }
    batches.set(key, {
      key,
      group: groupOf(notification)!,
      items: [notification],
      representative: notification,
      unreadCount: notification.read ? 0 : 1,
      sender:
        str(notification.payload, "sentByUsername") ??
        str(notification.payload, "sharedByUsername"),
    });
  }
  for (const [key, batch] of batches) {
    if (batch.items.length < 2) batches.delete(key);
  }
  return batches;
}

/**
 * The list to render: every non-batched row as it was, each batch replaced by
 * one header row, and an EXPANDED batch's members restored in full directly
 * beneath that header.
 *
 * "In full" includes the representative: the header is a synthetic row
 * (`batchHeaderRow`), so nothing is spent being the group's label and every
 * item is named when the group is opened.
 *
 * Members are pulled out of wherever they sat and re-inserted under the header
 * rather than left in place. Under unread-first sorting they are not adjacent —
 * expanding a half-read batch would otherwise scatter its rows down the screen
 * with nothing saying which belonged to what.
 */
export function collapseBatches(
  notifications: TNotification[],
  batches: Map<string, NotificationBatch>,
  expandedKeys: ReadonlySet<string>,
): TNotification[] {
  const rows: TNotification[] = [];
  for (const notification of notifications) {
    const key = batchKeyOf(notification);
    const batch = key ? batches.get(key) : undefined;
    if (!batch) {
      rows.push(notification);
      continue;
    }
    // The batch takes ONE slot, at the position of its first member; every
    // other member is either dropped (collapsed) or emitted below.
    if (batch.representative.id !== notification.id) continue;
    rows.push(batchHeaderRow(batch));
    if (expandedKeys.has(batch.key)) rows.push(...batch.items);
  }
  return rows;
}

/**
 * The grouped row's own sentence.
 *
 * Counts, never names: listing 23 canyon names in a header is both unreadable
 * and the kind of plaintext this inbox keeps out of anything but a row the user
 * has to act on. The two verbs keep their own word — "shared" is live and
 * revocable, "sent" is a copy for keeps — which is the distinction the whole
 * sharing feature exists to protect.
 */
export function batchLabel(batch: NotificationBatch): string {
  const who = batch.sender ?? "Someone";
  const count = batch.items.length;
  if (batch.group === "files") {
    return `${who} sent you ${count} files`;
  }
  return `${who} shared ${count} items with you`;
}

/**
 * The Accept-all / Turn-down-all pair, or null when a batch has nothing to
 * answer.
 *
 * Shares have no answer — a grant simply is — so only a file batch gets
 * buttons. `pending` is what those buttons would act on: a member already
 * accepted or expired is not offered again, so "Turn down all" on a batch where
 * six are already saved acts on two and says so.
 */
export function batchPendingFileSends(batch: NotificationBatch): TNotification[] {
  if (batch.group !== "files") return [];
  return batch.items.filter(
    (item) =>
      item.payload.fileSendStatus !== "expired" &&
      item.payload.fileSendStatus !== "accepted",
  );
}

/**
 * How many notifications a run of rows REPRESENTS — a batch being one of them.
 *
 * The day headers count the list, and the list is rows: expanding a group of
 * twelve turned "3" into "14" and collapsing it turned it back, which reads as
 * notifications arriving and leaving while the user looks at them. A batch is
 * one thing that happened — one friend, one gesture, one push — so it counts as
 * one, and the tally holds still while the group opens and shuts.
 *
 * That makes the header a count of EVENTS, not of rows on screen. The
 * alternative (always the member count) would have been just as stable, and was
 * rejected because it makes the number disagree with the rows in the collapsed
 * state, which is the state it is in nearly always.
 */
export function countBatchRows(
  rows: TNotification[],
  batches: Map<string, NotificationBatch>,
): number {
  return rows.filter((row) => {
    // The synthetic header row IS the batch: count it, and nothing else.
    if (batchKeyFromRowId(row.id) !== null) return true;
    const key = batchKeyOf(row);
    return key === null || !batches.has(key);
  }).length;
}

/** What a list of notifications amounts to once batches count as one thing. */
export type NotificationTally = { total: number; unread: number };

/**
 * Count a list the way the user sees it: ONE bulk share is one thing that
 * happened, however many rows it left behind.
 *
 * The inbox already collapsed a batch into a single row and `countBatchRows`
 * already made the day headers agree — but the tab badge, the hero and the
 * bucket chips were still counting members, so a friend sharing twelve items
 * put "12" on the More tab and opened an inbox showing one row. The badge is
 * the number a user acts on ("is there anything new?"), so it has to mean the
 * same thing the list does.
 *
 * A batch is UNREAD when any member is — the same test the collapsed row's
 * "New" pill uses, so the pill and the badge cannot disagree.
 *
 * Counts the raw list, unlike `countBatchRows`, which counts rows that have
 * already been through `collapseBatches` (and so may include synthetic header
 * rows). Both derive their idea of a batch from `findNotificationBatches`,
 * which is what keeps them agreeing.
 */
export function tallyNotifications(
  notifications: TNotification[],
): NotificationTally {
  const batches = findNotificationBatches(notifications);
  let total = 0;
  let unread = 0;
  for (const notification of notifications) {
    const key = batchKeyOf(notification);
    // A member is counted through its batch, below — never on its own.
    if (key && batches.has(key)) continue;
    total += 1;
    if (!notification.read) unread += 1;
  }
  for (const batch of batches.values()) {
    total += 1;
    if (batch.unreadCount > 0) unread += 1;
  }
  return { total, unread };
}
