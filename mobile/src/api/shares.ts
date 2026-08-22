// Direct per-item sharing — typed port of api/src/routes/shares.ts.
//
// A share here is a LIVE, REVOCABLE view of a record the user still owns
// (waypoint, route, LiDAR topo, GeoPDF). It is NOT the same promise as sending
// a copy of a file, which cannot be taken back — see shared/src/sharing.ts.
//
// Online-only, like the canyon sharing calls in ./friends.ts and for the same
// reason: the resulting rows and their tombstones reach the mirror on the next
// pull, but granting access is not a field use case and must not be queued in
// the outbox (the outbox carries entity mutations, not permission grants).
//
// PRIVACY: every response is username-only, server-enforced.
import type { SharableEntityType } from "@logjam/shared";

import { apiFetch } from "./apiFetch";

/** Same shape the canyon shares endpoint returns, deliberately. */
export type ShareRecipient = {
  id: string;
  sharedWith: { id: string; username: string };
};

export function getShares(
  entityType: SharableEntityType,
  entityId: string,
): Promise<ShareRecipient[]> {
  return apiFetch<ShareRecipient[]>(`/shares/${entityType}/${entityId}`);
}

export function shareItem(
  entityType: SharableEntityType,
  entityId: string,
  sharedWithUserId: string,
): Promise<unknown> {
  return apiFetch("/shares", {
    method: "POST",
    body: { entityType, entityId, sharedWithUserId },
  });
}

export function unshareItem(
  entityType: SharableEntityType,
  entityId: string,
  userId: string,
): Promise<void> {
  return apiFetch<void>(`/shares/${entityType}/${entityId}/${userId}`, {
    method: "DELETE",
  });
}
