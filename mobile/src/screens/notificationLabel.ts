// Pure label derivation for the notifications inbox — mirrors the JSX branches
// in web NotificationsPanel.tsx (frontend). Kept as data (text + optional
// warning subline) so it's vitest-testable and reusable by Stage 3 push
// handling. If web adds a notification type, add it here too; unknown types
// fall back to a generic label rather than rendering nothing.
import type { Feather } from "@expo/vector-icons";

import type { TNotification } from "../api/types";
import { notificationHue } from "../theme";

export type NotificationLabel = {
  text: string;
  warning?: string;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function notificationLabel(n: TNotification): NotificationLabel {
  const p = n.payload;
  switch (n.type) {
    case "friend_request":
      return { text: `${str(p.requesterUsername) ?? "Someone"} sent you a friend request` };
    case "friend_request_accepted":
      return { text: `${str(p.acceptedByUsername) ?? "Someone"} accepted your friend request` };
    case "canyon_shared":
      return {
        text: `${str(p.sharedByUsername) ?? "Someone"} shared ${str(p.canyonName) ?? "a canyon"} with you`,
      };
    // The filename is deliberately IN the label: the row carries Accept and
    // Turn down, and nobody can answer that without knowing what is on offer.
    // It is user text (routinely a canyon name), resolved from the live send at
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
        text: str(p.jobName) ? `${str(p.jobName)} topo complete` : "LiDAR topo processing complete",
        ...(p.osmFailed === true && {
          warning: "OSM features unavailable — Overpass API failed. Retry to fetch them.",
        }),
      };
    case "topo_failed":
      return {
        text: str(p.jobName) ? `${str(p.jobName)} topo failed` : "LiDAR topo processing failed",
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
          text: "GeoPDF generation failed",
          ...(str(p.errorMessage) && { warning: str(p.errorMessage)! }),
        };
      }
      return { text: "GeoPDF ready" };
    default:
      return { text: "Notification" };
  }
}

// ── Identity: glyph + hue ────────────────────────────────────────────────────
//
// Notifications are a genuine open-ended vocabulary of KINDS, so they get the
// §3 treatment. The hues are borrowed, not invented: a notification about a
// topo overlay wears the same eucalypt the overlay wears in Saved, and a
// canyon-share wears the same heath a shared canyon wears on the Canyons
// screen. The inbox is where you first hear about a thing — recognising it
// again where it lives is the point.

export type NotificationKind =
  | "share"
  | "file"
  | "people"
  | "topo"
  | "export"
  | "geoPdf"
  | "problem";

export type NotificationMeta = {
  kind: NotificationKind;
  icon: React.ComponentProps<typeof Feather>["name"];
  hue: string;
};

const KIND_META: Record<NotificationKind, { icon: NotificationMeta["icon"]; hue: string }> = {
  share: { icon: "share-2", hue: notificationHue.share },
  file: { icon: "file-plus", hue: notificationHue.file },
  people: { icon: "users", hue: notificationHue.people },
  topo: { icon: "layers", hue: notificationHue.topo },
  export: { icon: "download", hue: notificationHue.export },
  geoPdf: { icon: "file-text", hue: notificationHue.geoPdf },
  problem: { icon: "alert-triangle", hue: notificationHue.problem },
};

/**
 * A failed job is a PROBLEM first and a topo job second — the reason you scan an
 * inbox is to find the thing that went wrong, and giving failures their own
 * glyph and the warning hue is what makes that a glance instead of a read.
 */
function notificationKind(n: TNotification): NotificationKind {
  const failed = n.payload.status === "failed";
  switch (n.type) {
    case "canyon_shared":
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
    default:
      return "people";
  }
}

export function notificationMeta(n: TNotification): NotificationMeta {
  const kind = notificationKind(n);
  return { kind, ...KIND_META[kind] };
}

/**
 * The canyon this notification is ABOUT, if any — so tapping a share opens the
 * canyon instead of only marking the row read. Mirrors the push-tap routing in
 * AppShell, and reads the same `canyonId` the server puts in the payload.
 *
 * PRIVACY: an id, resolved against the authed API by the screen it opens. The
 * 404-not-403 rule covers a share revoked between the notification and the tap.
 */
export function notificationCanyonId(n: TNotification): string | null {
  const canyonId = n.payload.canyonId;
  return typeof canyonId === "string" && canyonId.length > 0 ? canyonId : null;
}

// ── Day grouping ─────────────────────────────────────────────────────────────

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
