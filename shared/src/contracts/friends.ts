// Friends and a friend's shares: Logjam Web's `FriendsPanel.tsx` and
// `FriendSharingSection.tsx`, Logjam GPS's `screens/FriendsScreen.tsx` and
// `sharing/FriendSharesScreen.tsx`.
//
// Declared elsewhere and read by both, not copied here: the share rows
// (`buildShareCards`), the bulk confirms (`unshareAllConfirm`,
// `removeAllConfirm`) and the selection count (`shareSelectionCountLabel`).
import type { IconIdea } from "../icons.js";
import type { ScreenContract } from "./types.js";

export const FRIENDS = {
  id: "friends.list",
  question: "Who can I share a place with, and who is waiting on me?",
  title: "Friends",
  sections: [
    { key: "hero" },
    // One rail, a true partition: a pending request is not a friend yet.
    { key: "buckets" },
    { key: "list" },
  ],
  copy: {
    add: "Add",
    addTitle: "Add a friend",
    searchField: "Search by username",
    searchHint: "Keep typing — at least 3 characters.",
    searchEmpty: "No one by that name.",

    bucketAll: "All",
    bucketFriends: "Friends",
    bucketRequests: "Requests",

    requestSubtitle: "Wants to be friends",
    pillFriend: "Friend",
    pillRequested: "Requested",

    firstRunTitle: "No friends yet",
    firstRunBody:
      "Friends are who you can share a place, a route or a map with. Find one by their username.",
    noRequestsTitle: "No pending requests",
    loadFailed: "Couldn't load friends.",

    acceptFailed: "Couldn't accept friend request.",
    declineFailed: "Couldn't decline friend request.",
    removeFailed: "Couldn't remove friend.",
    sendFailed: "Couldn't send friend request.",
    searchFailed: "Couldn't search users.",
    declined: "Request declined.",
  },
} as const satisfies ScreenContract;

export type FriendsBucket = "all" | "friends" | "requests";

/**
 * Logjam GPS's hero. A request outranks the count: it is the one thing
 * waiting on the user. Logjam Web's hero is `FRIENDS.title`: its chips show
 * both counts.
 */
export function friendsHeroTitle(requests: number, friends: number): string {
  if (requests > 0)
    return `${requests} ${requests === 1 ? "request" : "requests"}`;
  if (friends === 0) return "No friends yet";
  return `${friends} ${friends === 1 ? "friend" : "friends"}`;
}

/** What an empty list says, by what emptied it. */
export function friendsEmptyKind(state: {
  friends: number;
  requests: number;
  bucket: FriendsBucket;
}): "firstRun" | "noRequests" | null {
  if (state.friends === 0 && state.requests === 0) return "firstRun";
  if (state.bucket === "requests" && state.requests === 0) return "noRequests";
  if (state.bucket === "friends" && state.friends === 0) return "firstRun";
  return null;
}

export function friendAcceptedMessage(username: string): string {
  return `${username} is now a friend.`;
}

export function friendRemovedMessage(username: string): string {
  return `${username} removed.`;
}

/** Removing a friend ends sharing both ways; that is the whole cost. */
export function friendRemoveConfirm(username: string): {
  confirmTitle: string;
  confirmBody: string;
} {
  return {
    confirmTitle: `Remove ${username}?`,
    confirmBody: `Everything you share with each other stops being shared, both ways. You can send ${username} a friend request again later, and sharing does not come back with it.`,
  };
}

type FriendVerbDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
  /** What the row is: a person, or a request waiting on the user. */
  for: "friend" | "request";
  danger?: boolean;
  separated?: boolean;
};

/** A friend's and a request's verbs, in order. */
export const FRIEND_VERBS = [
  { id: "shares", icon: "shareFriend", label: "Shared items", for: "friend" },
  {
    id: "remove",
    icon: "unshare",
    label: "Remove friend",
    for: "friend",
    danger: true,
    separated: true,
  },
  { id: "accept", icon: "accept", label: "Accept", for: "request" },
  { id: "decline", icon: "ignore", label: "Decline", for: "request" },
] as const satisfies readonly FriendVerbDeclaration[];

export type FriendVerbId = (typeof FRIEND_VERBS)[number]["id"];

export function friendVerb(id: FriendVerbId) {
  return FRIEND_VERBS.find((verb) => verb.id === id)!;
}

export const FRIEND_SHARES = {
  id: "friends.shares",
  question: "What does this friend see of mine, and what do they let me see?",
  sections: [
    { key: "hero" },
    // "You share" / "They share": a direction, not a filter.
    { key: "directions" },
    { key: "note" },
    { key: "list" },
  ],
  copy: {
    youShare: "You share",
    theyShare: "They share",
    loading: "Loading sharing…",
    emptyHint: "Share a place, a route or a map from its own menu.",
    loadFailed: "Couldn't load what's shared with this friend.",
    unshareFailed: "Couldn't unshare. Try again.",
  },
} as const satisfies ScreenContract;

/** The line under the rail, saying which way the list runs. */
export function friendSharesNote(
  direction: "theySee" | "youSee",
  username: string,
): string {
  return direction === "theySee"
    ? `Items you have shared with ${username}.`
    : `Items ${username} has shared with you.`;
}

export function friendSharesEmptyTitle(
  direction: "theySee" | "youSee",
  username: string,
): string {
  return direction === "theySee"
    ? `You haven't shared anything with ${username}`
    : `${username} hasn't shared anything with you`;
}

export function unsharedMessage(title: string, username: string): string {
  return `${title} is no longer shared with ${username}.`;
}

export function bulkUnshareLabel(count: number, username: string): string {
  return `Unshare ${count} from ${username}`;
}

export function bulkRemoveLabel(count: number): string {
  return `Remove ${count} from your account`;
}

type ShareVerbDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
  /** Which way the row runs: shared with them, or with you. */
  direction?: "theySee" | "youSee";
  /** A verb only one client has says why. */
  on?: "gps";
  reason?: string;
};

const NO_WEB_MENU =
  "Logjam Web's share rows carry one inline button and no ⋯ menu: a gap, not a choice.";

/** A friend's share row's verbs, in order. */
export const FRIEND_SHARE_VERBS = [
  {
    id: "open",
    icon: "place",
    label: "Open place",
    on: "gps",
    reason: NO_WEB_MENU,
  },
  { id: "unshare", icon: "unshare", label: "Unshare", direction: "theySee" },
  {
    id: "copy",
    icon: "copy",
    label: "Save a copy",
    on: "gps",
    reason: NO_WEB_MENU,
  },
  {
    id: "copyAndRemove",
    icon: "moveCopy",
    label: "Save a copy and remove",
    on: "gps",
    reason: NO_WEB_MENU,
  },
  { id: "remove", icon: "hide", label: "Remove", direction: "youSee" },
] as const satisfies readonly ShareVerbDeclaration[];

export type FriendShareVerbId = (typeof FRIEND_SHARE_VERBS)[number]["id"];

export function friendShareVerb(id: FriendShareVerbId) {
  return FRIEND_SHARE_VERBS.find((verb) => verb.id === id)!;
}
