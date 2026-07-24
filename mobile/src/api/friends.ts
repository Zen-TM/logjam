// Friends + per-canyon sharing — typed ports of the authed API (api/src/routes/
// friends.ts, api/src/routes/sharing.ts). Online-only by design (Stage 8): the
// mirror already syncs the RESULTING friendships/shares/tombstones offline, but
// the management actions themselves are not field use cases, so they hit REST
// directly rather than routing through the outbox.
//
// PRIVACY: every response here is username-only (server-enforced — no email on
// friends joins). Search is capped server-side (min 3 chars, ≤10 results).
import { apiFetch } from "./apiFetch";

export type Friend = { id: string; username: string; friendshipId: string };

// GET /friends/requests returns friendship rows for pending requests RECEIVED,
// each including the requester (username-only).
export type FriendRequest = {
  id: string;
  requester: { id: string; username: string };
};

export type UserSearchResult = { id: string; username: string };

// GET /canyons/:id/shares returns CanyonShare rows with the recipient joined.
export type CanyonShareRecipient = {
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

export function getCanyonShares(canyonId: string): Promise<CanyonShareRecipient[]> {
  return apiFetch<CanyonShareRecipient[]>(`/canyons/${canyonId}/shares`);
}

export function shareCanyon(canyonId: string, sharedWithUserId: string): Promise<unknown> {
  return apiFetch(`/canyons/${canyonId}/share`, {
    method: "POST",
    body: { sharedWithUserId },
  });
}

export function unshareCanyon(canyonId: string, userId: string): Promise<void> {
  return apiFetch<void>(`/canyons/${canyonId}/share/${userId}`, { method: "DELETE" });
}
