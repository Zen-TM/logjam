// The Inbox: Logjam Web's `NotificationsPanel.tsx` and Logjam GPS's
// `screens/NotificationsScreen.tsx`. A row's words are `notificationLabel`;
// what a row asks is `notificationActions`; the bar's read/unread verb is
// `bulkReadAction`. This holds the page around them.
import type { IconIdea } from "../icons.js";
import type { ScreenContract } from "./types.js";
import { t } from "../i18n.js";

export const INBOX = {
  id: "inbox.list",
  question: t`What happened while I was away?`,
  title: t`Inbox`,
  sections: [
    { key: "hero" },
    // One rail: All / Unread / Read, which the selection bar replaces, and
    // the search bar under it.
    { key: "buckets" },
    { key: "truncated" },
    { key: "list" },
  ],
  copy: {
    searchField: t`Search notifications`,
    clearSearch: t`Clear search`,
    showEverything: t`Show everything`,
    markAllRead: t`Mark all as read`,
    markedAllRead: t`All marked as read.`,

    bucketAll: t`All`,
    bucketUnread: t`Unread`,
    bucketRead: t`Read`,

    // The row's mark while any of it is unread.
    unreadMark: t`New`,
    // A row's subject is gone: a share since revoked, a route since deleted.
    removed: t`This was removed.`,
    collapseGroup: t`Collapse this group`,
    expandGroup: t`Show each one`,

    loading: t`Loading your inbox…`,
    loadFailed: t`Couldn't load your inbox`,
    firstRunTitle: t`Nothing yet`,
    firstRunBody: t`Shares, friend requests and finished maps appear here.`,
    noMatchTitle: t`Nothing matches`,
    noMatchBody: t`The search runs over what a row says — a name, a place, a filename.`,
    noUnreadTitle: t`Nothing unread`,
    noUnreadBody: t`New shares, requests and finished maps land here.`,
    noReadTitle: t`Nothing read yet`,
    noReadBody: t`Open something, or mark it read, and it moves here.`,
  },
} as const satisfies ScreenContract;

/**
 * Logjam GPS's hero: what is unread, else that nothing is. Logjam Web's hero
 * is `INBOX.title`: its chips show the unread count.
 */
export function inboxHeroTitle(unread: number, total: number): string {
  if (unread > 0) return t`${unread} unread`;
  return total > 0 ? t`All caught up` : t`Nothing yet`;
}

/** The note over a list the server cut short. */
export function inboxTruncatedNote(shown: number, total: number): string {
  return t`Showing the ${shown} most recent of ${total}. Older ones aren't listed.`;
}

type InboxVerbDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
  danger?: boolean;
};

/**
 * The Inbox's own verbs, in the hero's ⋯: they act on the whole inbox, not on a
 * row. A "…" marks the one that asks first.
 */
export const INBOX_VERBS = [
  { id: "markAllRead", icon: "selectAll", label: t`Mark all as read` },
  {
    id: "clearRead",
    icon: "delete",
    label: t`Clear read notifications…`,
    danger: true,
  },
] as const satisfies readonly InboxVerbDeclaration[];

export type InboxVerbId = (typeof INBOX_VERBS)[number]["id"];

export function inboxVerb(id: InboxVerbId) {
  return INBOX_VERBS.find((verb) => verb.id === id)!;
}

/** What clearing the read notifications costs: read ones go everywhere, unread stay. */
export const CLEAR_READ_CONFIRM = {
  confirmTitle: t`Clear read notifications?`,
  confirmBody: t`Every notification you've read goes, from every device on your account. Unread ones stay.`,
  confirmLabel: t`Clear`,
  failed: t`Couldn't clear read notifications.`,
} as const;

type NotificationVerbDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
  danger?: boolean;
  separated?: boolean;
};

/**
 * A notification's ⋯, in order. "Open place" is only for one about a place,
 * "Open plan" for one about a plan the reader can open, "Read message" only
 * for a maintainer announcement; "View in …" names the tab its subject lives
 * in, which differs by client (Ways or Friends on Logjam Web, Saved or
 * Friends on Logjam GPS), so its label is the destination's own.
 * Read and Unread are one row whose direction follows the notification.
 */
export const NOTIFICATION_VERBS = [
  { id: "open", icon: "forward", label: t`Open place` },
  { id: "openPlan", icon: "forward", label: t`Open plan` },
  { id: "view", icon: "forward", label: t`View in …` },
  { id: "readMessage", icon: "forward", label: t`Read message` },
  { id: "markRead", icon: "show", label: t`Mark as read` },
  { id: "markUnread", icon: "hide", label: t`Mark as unread` },
  {
    id: "delete",
    icon: "delete",
    label: t`Delete notification`,
    danger: true,
    separated: true,
  },
] as const satisfies readonly NotificationVerbDeclaration[];

export type NotificationVerbId = (typeof NOTIFICATION_VERBS)[number]["id"];

/** One verb's declaration. */
export function notificationVerb(id: NotificationVerbId) {
  return NOTIFICATION_VERBS.find((verb) => verb.id === id)!;
}

/** What deleting notifications costs, said once. */
export function notificationDeleteConfirm(count: number): {
  confirmTitle: string;
  confirmBody: string;
} {
  const one = count === 1;
  return {
    confirmTitle: one
      ? t`Delete this notification?`
      : t`Delete ${count} notifications?`,
    confirmBody: one
      ? t`It goes from every device on your account. This can't be undone.`
      : t`They go from every device on your account. This can't be undone.`,
  };
}

/**
 * A maintainer announcement opened from its row: Logjam Web's dialog, Logjam
 * GPS's sheet. Its title is the message's own; `untitled` stands in when it
 * has none, and is also the push title (api/src/services/push.ts).
 */
export const ANNOUNCEMENT = {
  from: t`From the Logjam maintainer`,
  // A getter, so the API's push title reads the recipient's language when it
  // is sent: a constant would be written in the language known at import
  // (contractLanguage.test.ts).
  get untitled() {
    return t`A message from the Logjam maintainer`;
  },
} as const;
