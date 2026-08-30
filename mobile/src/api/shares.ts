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
import type {
  BulkShareItem,
  BulkShareResult,
  SharableEntityType,
} from "@logjam/shared";

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

/**
 * ONE bulk share action, and the END of it.
 *
 * Not a loop over `shareItem`: 23 items x 3 friends is 69 requests, 69
 * transactions and 69 pushes, and the recipient's phone is what pays for the
 * last of those. The server writes the lot in one transaction and fires ONE
 * push per recipient.
 *
 * CALL IT LAST. A bulk action's file copies go through `sendFileCopy` one
 * upload at a time carrying the same `batchId`, and each of those stays silent
 * precisely so this call can be the single announcement — which is only honest
 * if the uploads have already landed. `copyCount` is how a copy-only action
 * still gets that one push.
 *
 * Online-only, like every other call in this file.
 */
export function bulkShare(args: {
  items: BulkShareItem[];
  recipientIds: string[];
  /** Groups every notification this action creates. Mint one per action. */
  batchId: string;
  copyCount: number;
}): Promise<BulkShareResult> {
  return apiFetch<BulkShareResult>("/bulk-share", {
    method: "POST",
    body: args,
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
