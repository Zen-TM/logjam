import type { TNotification } from "./apiTypes.js";
import { ApiError } from "./apiErrors.js";

export type NotificationLabel = {
  text: string;
  warning?: string;
};

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function strVal(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * What a shared entity is CALLED in a sentence, by its `entityType`.
 *
 * Indefinite articles included because the label never names the item.
 * Keyed loosely rather than by strict enum: reads a wire payload, and unknown
 * entity types fall back to "an item".
 */
const SHARED_ITEM_NOUN: Record<string, string> = {
  waypoint: "a waypoint",
  route: "a route",
  topoJob: "a LiDAR topo",
  geoPdfJob: "a GeoPDF",
};

export function notificationLabel(n: TNotification): NotificationLabel {
  const p = n.payload;
  switch (n.type) {
    case "friend_request":
      return { text: `${strVal(p.requesterUsername) ?? "Someone"} sent you a friend request` };
    case "friend_request_accepted":
      return { text: `${strVal(p.acceptedByUsername) ?? "Someone"} accepted your friend request` };
    case "place_shared":
      return {
        text: `${strVal(p.sharedByUsername) ?? "Someone"} shared ${strVal(p.placeName) ?? "a place"} with you`,
      };
    case "item_shared":
      return {
        text: `${strVal(p.sharedByUsername) ?? "Someone"} shared ${SHARED_ITEM_NOUN[String(p.entityType)] ?? "an item"} with you`,
      };
    case "file_sent":
      return {
        text: `${strVal(p.sentByUsername) ?? "Someone"} sent you ${strVal(p.filename) ?? "a file"}`,
        ...(p.fileSendStatus === "expired" && {
          warning: `This file expired. Ask ${strVal(p.sentByUsername) ?? "them"} to send it again.`,
        }),
      };
    case "topo_complete":
      return {
        text: strVal(p.jobName) ? `${strVal(p.jobName)} map ready` : "LiDAR map ready",
        ...(p.osmFailed === true && {
          warning: "Roads and labels didn't download. Try again.",
        }),
      };
    case "topo_failed":
      return {
        text: strVal(p.jobName) ? `${strVal(p.jobName)} map failed` : "LiDAR map failed",
      };
    case "topo_export_complete": {
      const format = String(p.format ?? "Topo").toUpperCase();
      if (p.status === "failed") {
        return {
          text: `${format} export failed`,
          ...(strVal(p.errorMessage) && { warning: strVal(p.errorMessage)! }),
        };
      }
      return {
        text: `${format} export${strVal(p.jobName) ? ` for ${strVal(p.jobName)}` : ""} ready`,
      };
    }
    case "topo_export_skipped":
      return {
        text: "Auto-export didn't run",
        ...(strVal(p.reason) && { warning: strVal(p.reason)! }),
      };
    case "geo_pdf_complete":
      if (p.status === "failed") {
        return {
          text: "Couldn't create GeoPDF",
          ...(strVal(p.errorMessage) && { warning: strVal(p.errorMessage)! }),
        };
      }
      return { text: "GeoPDF ready" };
    case "egress_quota_warning":
      return { text: "Approaching your monthly download limit" };
    case "egress_quota_exceeded":
      return {
        text: "Monthly download limit reached",
        warning: "Downloads resume when the limit resets next month.",
      };
    default:
      return { text: "Notification" };
  }
}

/**
 * What the inbox's search matches against — the row's own visible words.
 */
export function notificationHaystack(n: TNotification): string {
  const label = notificationLabel(n);
  return `${label.text} ${label.warning ?? ""}`.toLowerCase();
}

export type NotificationKind =
  | "share"
  | "file"
  | "people"
  | "topo"
  | "export"
  | "geoPdf"
  | "problem";

export function notificationKind(n: TNotification): NotificationKind {
  const failed = n.payload.status === "failed";
  switch (n.type) {
    case "place_shared":
    case "item_shared":
      return "share";
    case "file_sent":
      return "file";
    case "friend_request":
    case "friend_request_accepted":
      return "people";
    case "topo_failed":
      return "problem";
    case "topo_complete":
      return "topo";
    case "topo_export_complete":
      return failed ? "problem" : "export";
    case "topo_export_skipped":
      return "problem";
    case "geo_pdf_complete":
      return failed ? "problem" : "geoPdf";
    case "egress_quota_warning":
    case "egress_quota_exceeded":
      return "problem";
    default:
      return "people";
  }
}

export function notificationPlaceId(n: TNotification): string | null {
  const placeId = n.payload.placeId;
  return typeof placeId === "string" && placeId.length > 0 ? placeId : null;
}

// ── Day grouping ─────────────────────────────────────────────────────────────

export type NotificationDay = {
  key: string;
  title: string;
  data: TNotification[];
};

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function groupNotificationsByDay(
  notifications: TNotification[],
  now: Date = new Date(),
): NotificationDay[] {
  const todayKey = localDayKey(now);
  const yesterday = new Date(now.getTime());
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDayKey(yesterday);

  const sections: NotificationDay[] = [];
  for (const notification of notifications) {
    const at = new Date(notification.createdAt);
    const key = Number.isNaN(at.getTime()) ? "unknown" : localDayKey(at);
    const last = sections[sections.length - 1];
    if (last && last.key === key) {
      last.data.push(notification);
      continue;
    }
    sections.push({ key, title: dayTitle(key, at, todayKey, yesterdayKey), data: [notification] });
  }
  return sections;
}

function dayTitle(key: string, at: Date, todayKey: string, yesterdayKey: string): string {
  if (key === "unknown") return "Unknown date";
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  return at.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(at.getFullYear() !== new Date(todayKey).getFullYear() ? { year: "numeric" } : {}),
  });
}

// ── Bulk Read Action ─────────────────────────────────────────────────────────

export type BulkReadAction = {
  read: boolean;
  ids: string[];
  icon: "eye" | "eye-off";
  label: string;
  success: string;
};

export function bulkReadAction(
  selected: { id: string; read: boolean }[],
): BulkReadAction | null {
  if (selected.length === 0) return null;
  const unread = selected.filter((notification) => !notification.read);
  if (unread.length === 0) {
    return {
      read: false,
      ids: selected.map((notification) => notification.id),
      icon: "eye-off",
      label: "Mark as unread",
      success: "Marked as unread.",
    };
  }
  return {
    read: true,
    ids: unread.map((notification) => notification.id),
    icon: "eye",
    label:
      unread.length === selected.length
        ? "Mark as read"
        : "Mark the unread ones as read",
    success: "Marked as read.",
  };
}

export function selectionCountLabel(selected: { read: boolean }[]): string {
  const unread = selected.filter((notification) => !notification.read).length;
  const base = `${selected.length} selected`;
  return unread === 0 ? base : `${base} · ${unread} unread`;
}

// ── Resolved Elsewhere Error Check ───────────────────────────────────────────

export function isResolvedElsewhereError(err: unknown): boolean {
  return (
    err != null &&
    typeof err === "object" &&
    "status" in err &&
    (err.status === 400 || err.status === 404 || err.status === 409)
  );
}

/**
 * All IDs between `from` and `to`, inclusive, in list order (shift-click).
 * Just `to` when the anchor is no longer in the list.
 */
export function idRange(ids: readonly string[], from: string | null, to: string): string[] {
  const end = ids.indexOf(to);
  const start = from == null ? -1 : ids.indexOf(from);
  if (end < 0) return [];
  if (start < 0) return [to];
  return ids.slice(Math.min(start, end), Math.max(start, end) + 1);
}

// ── Notification Batches ─────────────────────────────────────────────────────

export type BatchGroup = "shares" | "files";

export type NotificationBatch = {
  key: string;
  group: BatchGroup;
  items: TNotification[];
  representative: TNotification;
  unreadCount: number;
  sender: string | null;
};

const BATCH_ROW_PREFIX = "batch:";

export function batchHeaderRow(batch: NotificationBatch): TNotification {
  return { ...batch.representative, id: `${BATCH_ROW_PREFIX}${batch.key}` };
}

export function batchKeyFromRowId(id: string): string | null {
  return id.startsWith(BATCH_ROW_PREFIX)
    ? id.slice(BATCH_ROW_PREFIX.length)
    : null;
}

function groupOf(n: TNotification): BatchGroup | null {
  if (n.type === "file_sent") return "files";
  if (n.type === "item_shared" || n.type === "place_shared") return "shares";
  return null;
}

export function batchKeyOf(n: TNotification): string | null {
  const batchId = str(n.payload, "batchId");
  if (!batchId) return null;
  const group = groupOf(n);
  return group ? `${batchId}:${group}` : null;
}

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
    if (batch.representative.id !== notification.id) continue;
    rows.push(batchHeaderRow(batch));
    if (expandedKeys.has(batch.key)) rows.push(...batch.items);
  }
  return rows;
}

export function batchLabel(batch: NotificationBatch): string {
  const who = batch.sender ?? "Someone";
  const count = batch.items.length;
  if (batch.group === "files") {
    return `${who} sent you ${count} files`;
  }
  return `${who} shared ${count} items with you`;
}

export function batchPendingFileSends(batch: NotificationBatch): TNotification[] {
  if (batch.group !== "files") return [];
  return batch.items.filter(
    (item) =>
      item.payload.fileSendStatus !== "expired" &&
      item.payload.fileSendStatus !== "accepted",
  );
}

export function countBatchRows(
  rows: TNotification[],
  batches: Map<string, NotificationBatch>,
): number {
  return rows.filter((row) => {
    if (batchKeyFromRowId(row.id) !== null) return true;
    const key = batchKeyOf(row);
    return key === null || !batches.has(key);
  }).length;
}

export type NotificationTally = { total: number; unread: number };

export function tallyNotifications(
  notifications: TNotification[],
): NotificationTally {
  const batches = findNotificationBatches(notifications);
  let total = 0;
  let unread = 0;
  for (const notification of notifications) {
    const key = batchKeyOf(notification);
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
