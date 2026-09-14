// Pure label derivation for the notifications inbox, read by Logjam GPS and
// Logjam Web alike so the two inboxes cannot word the same event differently.
// Kept as data (text + optional warning subline) so it is testable and
// reusable by push handling. A new notification type is a branch here; unknown
// types fall back to a generic label rather than rendering nothing.
import type { TNotification } from "./apiTypes.js";

export type NotificationLabel = {
  text: string;
  warning?: string;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * What a shared entity is CALLED in a sentence, by its `entityType`.
 *
 * Indefinite articles included because the label never names the item — see the
 * `item_shared` branch below. Keyed loosely (a `string` index) rather than by
 * `SharableEntityType` on purpose: this reads a payload off the wire, and an
 * entity type this build has never heard of must fall back to "an item" rather
 * than render a raw enum name.
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
      return { text: `${str(p.requesterUsername) ?? "Someone"} sent you a friend request` };
    case "friend_request_accepted":
      return { text: `${str(p.acceptedByUsername) ?? "Someone"} accepted your friend request` };
    case "place_shared":
      return {
        text: `${str(p.sharedByUsername) ?? "Someone"} shared ${str(p.placeName) ?? "a place"} with you`,
      };
    // A directly-shared saved item. The payload carries the entity's TYPE and
    // its id, and deliberately no name: the recipient already holds the row
    // through delta sync or its own list endpoint, so resolving a waypoint's
    // name into a notification payload would put user text on the wire for
    // nothing (api/src/routes/notifications.ts says so at the resolve site).
    // The row therefore names the KIND, and the ⋯ sheet's "View in Saved" is
    // what shows which one.
    case "item_shared":
      return {
        text: `${str(p.sharedByUsername) ?? "Someone"} shared ${SHARED_ITEM_NOUN[String(p.entityType)] ?? "an item"} with you`,
      };
    // The filename is deliberately IN the label: the row carries Accept and
    // Turn down, and nobody can answer that without knowing what is on offer.
    // It is user text (routinely a place name), resolved from the live send at
    // read time — rendered here, never logged.
    case "file_sent":
      return {
        text: `${str(p.sentByUsername) ?? "Someone"} sent you ${str(p.filename) ?? "a file"}`,
        // A send that lapsed before it was saved keeps its row and loses its
        // buttons, so the row has to say why it can no longer be answered —
        // otherwise the offer just disappears and the user is left looking for
        // something a friend told them they had sent. Only ever shown for a
        // send they never took: an accepted one is dropped server-side.
        ...(p.fileSendStatus === "expired" && {
          warning: `This file expired. Ask ${str(p.sentByUsername) ?? "them"} to send it again.`,
        }),
      };
    case "topo_complete":
      return {
        text: str(p.jobName) ? `${str(p.jobName)} map ready` : "LiDAR map ready",
        ...(p.osmFailed === true && {
          warning: "Roads and labels didn't download. Try again.",
        }),
      };
    case "topo_failed":
      return {
        text: str(p.jobName) ? `${str(p.jobName)} map failed` : "LiDAR map failed",
      };
    case "topo_export_complete": {
      const format = String(p.format ?? "Topo").toUpperCase();
      if (p.status === "failed") {
        return {
          text: `${format} export failed`,
          ...(str(p.errorMessage) && { warning: str(p.errorMessage)! }),
        };
      }
      return {
        text: `${format} export${str(p.jobName) ? ` for ${str(p.jobName)}` : ""} ready`,
      };
    }
    case "topo_export_skipped":
      return {
        text: "Auto-export didn't run",
        ...(str(p.reason) && { warning: str(p.reason)! }),
      };
    case "geo_pdf_complete":
      if (p.status === "failed") {
        return {
          text: "Couldn't create GeoPDF",
          ...(str(p.errorMessage) && { warning: str(p.errorMessage)! }),
        };
      }
      return { text: "GeoPDF ready" };
    // Egress has no meter in the app - the allowance sits far above real use,
    // so these two rows are its entire user-facing surface.
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
 * What the inbox's search field matches against — the row's own words, and
 * only those.
 *
 * Derived from `notificationLabel` rather than from the payload, so it can only
 * ever match text the user can actually see: searching a field that is not on
 * screen produces a list whose rows have no visible reason to be there. That
 * also keeps ids and timestamps out of it, which nobody types.
 */
export function notificationHaystack(n: TNotification): string {
  const label = notificationLabel(n);
  return `${label.text} ${label.warning ?? ""}`.toLowerCase();
}

// ── Identity: the kind ───────────────────────────────────────────────────────
//
// Notifications are a genuine open-ended vocabulary of KINDS, so they get a
// glyph and a hue each (both DESIGN.md files, §3). Which kind a notification is
// is decided here; each client draws the kind in its own icon family and in
// the hue of the thing the notification is about.

export type NotificationKind =
  | "share"
  | "file"
  | "people"
  | "topo"
  | "export"
  | "geoPdf"
  | "problem";

/**
 * A failed job is a PROBLEM first and a topo job second — the reason you scan an
 * inbox is to find the thing that went wrong, and giving failures their own
 * glyph and the warning hue is what makes that a glance instead of a read.
 */
export function notificationKind(n: TNotification): NotificationKind {
  const failed = n.payload.status === "failed";
  switch (n.type) {
    case "place_shared":
    // Same verb, same promise: a live view of a row someone else still owns.
    case "item_shared":
      return "share";
    // NOT "share": a sent file is a copy that becomes the recipient's own, and
    // wearing the share hue is the one confusion the two verbs exist to prevent.
    case "file_sent":
      return "file";
    case "friend_request":
    case "friend_request_accepted":
      return "people";
    case "topo_failed":
      return "problem";
    case "topo_complete":
      // A completed job whose OSM fetch failed is still a completion.
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

/**
 * The place this notification is ABOUT, if any — so tapping a share opens the
 * place instead of only marking the row read. Mirrors the push-tap routing in
 * AppShell, and reads the same `placeId` the server puts in the payload.
 *
 * PRIVACY: an id, resolved against the authed API by the screen it opens. The
 * 404-not-403 rule covers a share revoked between the notification and the tap.
 */
export function notificationPlaceId(n: TNotification): string | null {
  const placeId = n.payload.placeId;
  return typeof placeId === "string" && placeId.length > 0 ? placeId : null;
}

// ── The list: its cap, order and day grouping ────────────────────────────────

/** `GET /notifications` returns at most this many rows, and the true total in
 *  `X-Total-Count` beside them. */
export const NOTIFICATIONS_LIST_CAP = 500;

/**
 * Whether the server's cap cut the inbox short, from the total it reported.
 *
 * NOT `total > notifications.length`, which both clients used to test: the
 * total counts every stored row, and the endpoint then drops the rows it can no
 * longer resolve (a revoked share, a removed friendship — PRIV-001/003). So an
 * inbox of 13 rows showing 7 said "Showing 7 of 13. Older ones aren't loaded"
 * with nothing older at all. Only a total past the cap means a row was left out.
 */
export function notificationsTruncated(total: number | null): boolean {
  return total !== null && total > NOTIFICATIONS_LIST_CAP;
}

/**
 * NEWEST FIRST, and never re-sorted by read state. The server returns
 * `read: asc` then `createdAt: desc`, which made acting on a row teleport it
 * to the bottom of the list mid-gesture — and, because the day grouping runs
 * over whatever order it is handed, it could also emit "Today" twice with a
 * week in between. A list ordered by time stays put while you work down it.
 *
 * Both inboxes read this. Logjam GPS learned it first; Logjam Web kept the
 * server's order until 2026-09-14, and marking a row read there moved it below
 * every unread one. An unparseable timestamp sorts last rather than poisoning
 * the comparison.
 */
export function newestNotificationsFirst(notifications: readonly TNotification[]): TNotification[] {
  const time = (n: TNotification) => {
    const parsed = Date.parse(n.createdAt);
    return Number.isNaN(parsed) ? -Infinity : parsed;
  };
  return [...notifications].sort((a, b) => time(b) - time(a) || 0);
}

export type NotificationDay = {
  /** Local calendar day, `YYYY-MM-DD` — the section key. */
  key: string;
  /** Sticky header text: "Today", "Yesterday", or the date. */
  title: string;
  data: TNotification[];
};

/**
 * A LOCAL calendar day key. `createdAt` is a true instant (not a date-only
 * value), and the day it belongs to is the user's day: reading it in UTC files
 * the first hours of every AEST morning under yesterday (§11).
 */
function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Group an already-newest-first list into consecutive day sections. Grouping
 * runs rather than bucketing by key on purpose: it preserves whatever order the
 * server sent, so a section can never silently reorder the list.
 */
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
    // An unparseable timestamp still has to appear somewhere; an "Unknown date"
    // section is better than dropping a notification on the floor.
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
    // Only worth the width once the year is ambiguous.
    ...(at.getFullYear() !== new Date(todayKey).getFullYear() ? { year: "numeric" } : {}),
  });
}
