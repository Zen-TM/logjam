// The Inbox: Logjam Web's `NotificationsPanel.tsx` and Logjam GPS's
// `screens/NotificationsScreen.tsx`. A row's words are `notificationLabel`;
// what a row asks is `notificationActions`; the bar's read/unread verb is
// `bulkReadAction`. This holds the page around them.
import type { IconIdea } from "../icons.js";
import type { ScreenContract } from "./types.js";

export const INBOX = {
  id: "inbox.list",
  question: "What happened while I was away?",
  title: "Inbox",
  sections: [
    { key: "hero" },
    // One rail: All / Unread / Read. The selection bar takes its place.
    { key: "buckets" },
    { key: "truncated" },
    { key: "list" },
  ],
  copy: {
    searchField: "Search notifications",
    closeSearch: "Close search",
    clearSearch: "Clear search",
    showEverything: "Show everything",
    markAllRead: "Mark all as read",

    bucketAll: "All",
    bucketUnread: "Unread",
    bucketRead: "Read",

    // The row's mark while any of it is unread.
    unreadMark: "New",
    collapseGroup: "Collapse this group",
    expandGroup: "Show each one",

    loading: "Loading your inbox…",
    loadFailed: "Couldn't load your inbox",
    firstRunTitle: "Nothing yet",
    firstRunBody: "Shares, friend requests and finished maps appear here.",
    noMatchTitle: "Nothing matches",
    noMatchBody:
      "The search runs over what a row says — a name, a place, a filename.",
    noUnreadTitle: "Nothing unread",
    noReadTitle: "Nothing read yet",
  },
} as const satisfies ScreenContract;

/**
 * Logjam GPS's hero: what is unread, else that nothing is. Logjam Web's hero
 * is `INBOX.title`: its chips show the unread count.
 */
export function inboxHeroTitle(unread: number, total: number): string {
  if (unread > 0) return `${unread} unread`;
  return total > 0 ? "All caught up" : "Nothing yet";
}

/** The note over a list the server cut short. */
export function inboxTruncatedNote(shown: number, total: number): string {
  return `Showing the ${shown} most recent of ${total}. Older ones aren't listed.`;
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
  { id: "markAllRead", icon: "selectAll", label: "Mark all as read" },
  {
    id: "clearRead",
    icon: "delete",
    label: "Clear read notifications…",
    danger: true,
  },
] as const satisfies readonly InboxVerbDeclaration[];

export type InboxVerbId = (typeof INBOX_VERBS)[number]["id"];

export function inboxVerb(id: InboxVerbId) {
  return INBOX_VERBS.find((verb) => verb.id === id)!;
}

/** What clearing the read notifications costs: read ones go everywhere, unread stay. */
export const CLEAR_READ_CONFIRM = {
  confirmTitle: "Clear read notifications?",
  confirmBody:
    "Every notification you've read goes, from every device on your account. Unread ones stay.",
  confirmLabel: "Clear",
  failed: "Couldn't clear read notifications.",
} as const;

type NotificationVerbDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
  danger?: boolean;
  separated?: boolean;
};

/**
 * A notification's ⋯, in order. "Open" is only for one about a place; "View
 * in …" names the tab its subject lives in, which differs by client (Maps on
 * Logjam Web, Saved on Logjam GPS), so its label is the destination's own.
 * Read and Unread are one row whose direction follows the notification.
 */
export const NOTIFICATION_VERBS = [
  { id: "open", icon: "forward", label: "Open place" },
  { id: "view", icon: "forward", label: "View in …" },
  { id: "markRead", icon: "show", label: "Mark as read" },
  { id: "markUnread", icon: "hide", label: "Mark as unread" },
  {
    id: "delete",
    icon: "delete",
    label: "Delete notification",
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
      ? "Delete this notification?"
      : `Delete ${count} notifications?`,
    confirmBody: `${one ? "It goes" : "They go"} from every device on your account. This can't be undone.`,
  };
}
