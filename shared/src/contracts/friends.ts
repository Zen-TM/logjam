// Friends and a friend's shares: Logjam Web's `FriendsPanel.tsx` and
// `FriendSharingSection.tsx`, Logjam GPS's `screens/FriendsScreen.tsx` and
// `sharing/FriendSharesScreen.tsx`.
//
// Declared elsewhere and read by both, not copied here: the share rows
// (`buildShareCards`), the bulk confirms (`unshareAllConfirm`,
// `removeAllConfirm`) and the selection count (`shareSelectionCountLabel`).
import { FRIEND_INVITE_TTL_DAYS } from "../friendInvite.js";
import type { IconIdea } from "../icons.js";
import type { ScreenContract } from "./types.js";
import { plural, t } from "../i18n.js";

/** The shortest username search the API answers (GET /friends/search). */
export const USER_SEARCH_MIN_CHARS = 3;

export const FRIENDS = {
  id: "friends.list",
  question: t`Who can I share a place with, and who is waiting on me?`,
  title: t`Friends`,
  sections: [
    { key: "hero" },
    // One rail, a true partition: a pending request is not a friend yet.
    { key: "buckets" },
    { key: "list" },
  ],
  copy: {
    add: t`Add`,
    addTitle: t`Add friend`,
    searchField: t`Search by username`,
    searchHint: t`Keep typing — at least ${USER_SEARCH_MIN_CHARS} characters.`,
    searchEmpty: t`No one by that name.`,

    bucketAll: t`All`,
    bucketFriends: t`Friends`,
    bucketRequests: t`Requests`,

    requestSubtitle: t`Wants to be friends`,
    pillFriend: t`Friend`,
    pillRequested: t`Requested`,

    firstRunTitle: t`No friends yet`,
    firstRunBody: t`Friends are who you can share a place, a route or a map with. Find one by their username.`,
    noRequestsTitle: t`No pending requests`,
    noRequestsBody: t`A request you send or receive waits here until someone answers it.`,
    loadFailed: t`Couldn't load friends.`,

    removeFailed: t`Couldn't remove friend.`,
    sendFailed: t`Couldn't send friend request.`,
    searchFailed: t`Couldn't search users.`,

    // The invite link, under the search in the Add sheet.
    inviteHint: t`Or send a link. It makes one person your friend when they open it and sign in, and stops working after ${FRIEND_INVITE_TTL_DAYS} days.`,
    inviteCopy: t`Copy invite link`,
    inviteShare: t`Share invite link`,
    inviteCopied: t`Invite link copied.`,
    inviteFailed: t`Couldn't make an invite link.`,
    inviteCopyFailed: t`Couldn't copy the invite link.`,
    inviteRevoke: t`Turn off my links`,
    inviteRevoked: t`Your invite links no longer work.`,
    inviteRevokeFailed: t`Couldn't turn off your invite links.`,
    // Opening one.
    inviteSignIn: t`Sign in or create an account to accept your friend invite.`,
    inviteAccept: t`Add friend`,
    inviteInvalid: t`This invite link no longer works. Ask for a new one.`,
  },
} as const satisfies ScreenContract;

export type FriendsBucket = "all" | "friends" | "requests";

/**
 * The line under Logjam GPS's "Friends" title. A request outranks the count:
 * it is the one thing waiting on the user. Logjam Web's chips show both
 * counts.
 */
export function friendsHeroSubtitle(requests: number, friends: number): string {
  if (requests > 0) return plural(requests, "# request", "# requests");
  if (friends === 0) return t`No friends yet`;
  return plural(friends, "# friend", "# friends");
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
  return t`${username} is now a friend.`;
}

/**
 * Whether sending a request made a friend. POST /friends/request answers
 * with the friendship row, and that row is already accepted when the other
 * person had asked first: the Add row then says Friend, not Requested.
 */
export function friendRequestMadeFriend(response: unknown): boolean {
  return (response as { status?: unknown } | null)?.status === "accepted";
}

/** How many links are out, beside the button that turns them off. */
export function friendInvitesLiveLabel(count: number): string {
  return plural(count, "# link not used yet.", "# links not used yet.");
}

/** What goes in the message a link is sent with. */
export function friendInviteMessage(url: string): string {
  return t`Add me as a friend on Logjam: ${url}`;
}

/**
 * What opening a link asks. It says what a friendship does NOT do, because
 * that is the question someone handed a link by a canyoner will have.
 */
export function friendInviteConfirm(username: string): {
  confirmTitle: string;
  confirmBody: string;
} {
  return {
    confirmTitle: t`Add ${username} as a friend?`,
    confirmBody: t`${username} sent you an invite link. Friends can share places, routes and maps with each other; nothing of yours is shared until you choose to share it.`,
  };
}

export function alreadyFriendsMessage(username: string): string {
  return t`You and ${username} are already friends.`;
}

export function friendRemovedMessage(username: string): string {
  return t`${username} removed.`;
}

/** Removing a friend ends sharing both ways; that is the whole cost. */
export function friendRemoveConfirm(username: string): {
  confirmTitle: string;
  confirmBody: string;
} {
  return {
    confirmTitle: t`Remove ${username}?`,
    confirmBody: t`Everything you share with each other stops being shared, both ways. You can send ${username} a friend request again later, and sharing does not come back with it.`,
  };
}

/** The same confirm for a selection of friends (Logjam Web's bulk bar). */
export function friendsRemoveConfirm(count: number): {
  confirmTitle: string;
  confirmBody: string;
} {
  return {
    confirmTitle: t`Remove ${count} friends?`,
    confirmBody: t`Everything you share with each of them stops being shared, both ways. You can send them a friend request again later, and sharing does not come back with it.`,
  };
}

export function friendsRemovedMessage(count: number): string {
  return t`${count} friends removed.`;
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
  { id: "shares", icon: "shareFriend", label: t`Shared items`, for: "friend" },
  {
    id: "remove",
    icon: "removeFriend",
    label: t`Remove friend`,
    for: "friend",
    danger: true,
    separated: true,
  },
  { id: "accept", icon: "accept", label: t`Accept`, for: "request" },
  { id: "decline", icon: "ignore", label: t`Decline`, for: "request" },
] as const satisfies readonly FriendVerbDeclaration[];

export type FriendVerbId = (typeof FRIEND_VERBS)[number]["id"];

export function friendVerb(id: FriendVerbId) {
  return FRIEND_VERBS.find((verb) => verb.id === id)!;
}

export const FRIEND_SHARES = {
  id: "friends.shares",
  question: t`What does this friend see of mine, and what do they let me see?`,
  sections: [
    { key: "hero" },
    // "You share" / "They share": a direction, not a filter.
    { key: "directions" },
    { key: "note" },
    { key: "list" },
  ],
  copy: {
    youShare: t`You share`,
    theyShare: t`They share`,
    loading: t`Loading sharing…`,
    emptyHint: t`Share a place, a route or a map from its own menu.`,
    loadFailed: t`Couldn't load what's shared with this friend.`,
    unshareFailed: t`Couldn't stop sharing. Try again.`,
  },
} as const satisfies ScreenContract;

/** The line under the rail, saying which way the list runs. */
export function friendSharesNote(
  direction: "theySee" | "youSee",
  username: string,
): string {
  return direction === "theySee"
    ? t`Items you have shared with ${username}.`
    : t`Items ${username} has shared with you.`;
}

export function friendSharesEmptyTitle(
  direction: "theySee" | "youSee",
  username: string,
): string {
  return direction === "theySee"
    ? t`You haven't shared anything with ${username}`
    : t`${username} hasn't shared anything with you`;
}

export function unsharedMessage(title: string, username: string): string {
  return t`${title} is no longer shared with ${username}.`;
}

export function bulkUnshareLabel(count: number, username: string): string {
  return t`Stop sharing ${count} with ${username}`;
}

export function bulkRemoveLabel(count: number): string {
  return t`Remove ${count} from your account`;
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
  /** Not built yet on the other client; never with a `reason`. */
  gap?: string;
};

const NO_WEB_MENU_GAP = t`Logjam Web's share rows carry one inline button and no ⋯ menu.`;

/** A friend's share row's verbs, in order. */
export const FRIEND_SHARE_VERBS = [
  {
    id: "open",
    icon: "place",
    label: t`Open place`,
    on: "gps",
    gap: NO_WEB_MENU_GAP,
  },
  {
    id: "unshare",
    icon: "unshare",
    label: t`Stop sharing`,
    direction: "theySee",
  },
  {
    id: "copy",
    icon: "copy",
    label: t`Save a copy`,
    on: "gps",
    gap: NO_WEB_MENU_GAP,
  },
  {
    id: "copyAndRemove",
    icon: "moveCopy",
    label: t`Save a copy and remove`,
    on: "gps",
    gap: NO_WEB_MENU_GAP,
  },
  {
    id: "remove",
    icon: "hide",
    label: t`Remove from my account`,
    direction: "youSee",
  },
] as const satisfies readonly ShareVerbDeclaration[];

export type FriendShareVerbId = (typeof FRIEND_SHARE_VERBS)[number]["id"];

export function friendShareVerb(id: FriendShareVerbId) {
  return FRIEND_SHARE_VERBS.find((verb) => verb.id === id)!;
}
