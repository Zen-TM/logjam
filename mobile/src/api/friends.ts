// Friends + per-place sharing — typed ports of the authed API (api/src/routes/
// friends.ts, api/src/routes/sharing.ts). Online-only by design (Stage 8): the
// mirror already syncs the RESULTING friendships/shares/tombstones offline, but
// the management actions themselves are not field use cases, so they hit REST
// directly rather than routing through the outbox.
//
// PRIVACY: every response here is username-only (server-enforced — no email on
// friends joins). Search is capped server-side (min 3 chars, ≤10 results).
import type { BulkShareItem, FriendShares } from "@logjam/shared";

import { apiFetch } from "./apiFetch";

export type Friend = { id: string; username: string; friendshipId: string };

// GET /friends/requests returns friendship rows for pending requests RECEIVED,
// each including the requester (username-only).
export type FriendRequest = {
  id: string;
  requester: { id: string; username: string };
};

export type UserSearchResult = { id: string; username: string };

// GET /places/:id/shares returns PlaceShare rows with the recipient joined.
export type PlaceShareRecipient = {
  id: string;
  sharedWith: { id: string; username: string };
};

export function getFriends(): Promise<Friend[]> {
  return apiFetch<Friend[]>("/friends");
}

export function getFriendRequests(): Promise<FriendRequest[]> {
  return apiFetch<FriendRequest[]>("/friends/requests");
}

/** Username search (server requires ≥3 chars). Caller must pre-check length. */
export function searchUsers(query: string): Promise<UserSearchResult[]> {
  return apiFetch<UserSearchResult[]>(`/friends/search?q=${encodeURIComponent(query)}`);
}

export function sendFriendRequest(addresseeId: string): Promise<unknown> {
  return apiFetch("/friends/request", { method: "POST", body: { addresseeId } });
}

export function acceptFriendRequest(friendshipId: string): Promise<unknown> {
  return apiFetch(`/friends/${friendshipId}/accept`, { method: "PATCH" });
}

export function declineFriendRequest(friendshipId: string): Promise<void> {
  return apiFetch<void>(`/friends/${friendshipId}/decline`, { method: "PATCH" });
}

export function removeFriend(friendshipId: string): Promise<void> {
  return apiFetch<void>(`/friends/${friendshipId}`, { method: "DELETE" });
}

export function getPlaceShares(placeId: string): Promise<PlaceShareRecipient[]> {
  return apiFetch<PlaceShareRecipient[]>(`/places/${placeId}/shares`);
}

export function sharePlace(placeId: string, sharedWithUserId: string): Promise<unknown> {
  return apiFetch(`/places/${placeId}/share`, {
    method: "POST",
    body: { sharedWithUserId },
  });
}

export function unsharePlace(placeId: string, userId: string): Promise<void> {
  return apiFetch<void>(`/places/${placeId}/share/${userId}`, { method: "DELETE" });
}

// ── The per-friend sharing audit ─────────────────────────────
// "What does this friend see, and what do they let me see?" — both directions
// of both share tables, in one request. The screen is FriendSharesScreen.

/** Everything shared either way with one friend, newest grant first. */
export function getFriendShares(friendshipId: string): Promise<FriendShares> {
  return apiFetch<FriendShares>(`/friends/${friendshipId}/shares`);
}

/**
 * Revoke grants I made to this friend. `items` is the selection — passing it is
 * how a multi-select of 3 out of 11 revokes 3.
 *
 * OMITTING IT MEANS EVERYTHING, which is the endpoint's older contract and is
 * NOT what any screen here wants: this app always knows which rows it is
 * acting on, and "all" is just the case where the user selected them all. The
 * parameter is therefore required.
 */
export function unshareWithFriend(
  friendshipId: string,
  items: BulkShareItem[],
): Promise<{
  revokedCount: number;
  placesRevokedCount: number;
  itemsRevokedCount: number;
}> {
  return apiFetch(`/friends/${friendshipId}/shares`, {
    method: "DELETE",
    body: {
      items: items.map(({ entityType, entityId }) => ({ entityType, entityId })),
    },
  });
}

/** What a place copy DID, beyond minting the row. */
export type PlaceCopyResult = {
  id: string;
  /** A place type was created for the copy — the client says so in its toast. */
  createdPlaceType?: boolean;
  /** Place-level media the copy now owns. */
  mediaCopied?: number;
  /** Media the copy did NOT get. Never silent: see `copyOutcomeMessage`. */
  mediaSkipped?: number;
  /** The skip was the copier's storage filling up, not a transfer failure. */
  mediaOutOfSpace?: true;
};

/**
 * Keep a place a friend shared: copies the record (and its linked route) into
 * my own account, server-side. The copy is MINE — editable, and unaffected if
 * the friend later revokes the share.
 *
 * `copyMedia` decides whether the place's photos and files come too, and is
 * charged to this account's storage quota when it does. OMITTING it is not the
 * same as false: the server then falls back to `uiPreferences.copyPlaceMedia`,
 * which is what the user last chose. Only pass it when the user answered the
 * question on THIS copy.
 *
 * The new place reaches this device through the next delta pull, so callers
 * `requestSync()` afterwards rather than inserting into the mirror themselves
 * (there is no local id to insert: the server mints it).
 */
export function copySharedPlace(
  placeId: string,
  options?: { copyMedia?: boolean },
): Promise<PlaceCopyResult> {
  return apiFetch<PlaceCopyResult>(`/places/${placeId}/copy`, {
    method: "POST",
    ...(options?.copyMedia === undefined
      ? {}
      : { body: { copyMedia: options.copyMedia } }),
  });
}
