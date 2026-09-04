// Getting rid of something a friend shared WITH you — the phone's half of the
// recipient-side revoke both share endpoints have always accepted
// (`DELETE …/me`). The web's twin is frontend/src/components/common/
// RemoveSharedButton.tsx; the wording both of them use comes from
// `removeShareConfirm` in shared/src/sharing.ts.
//
// ONLINE-ONLY, exactly like granting a share (api/shares.ts says why): the
// outbox carries entity mutations, not permission changes, and a queued
// "forget this for me" would leave the row on screen for an unbounded time
// while claiming it had gone.
//
// THE LOCAL EFFECT IS APPLIED HERE, not left to the next delta pull. The server
// writes a tombstone in the same transaction as the revoke, so the mirror WILL
// converge — but "converge on the next pull" means the thing the user just
// removed stays on their screen until then, which reads as the tap having
// failed. Applying the same tombstone locally is what the pull would do anyway
// (mirrorStore.applyTombstone), so a redelivery is a no-op rather than a
// conflict.
import { deleteAsync } from "expo-file-system/legacy";
import type { SharableEntityType } from "@logjam/shared";

import { unshareCanyon } from "../api/friends";
import { unshareItem } from "../api/shares";
import { applyTombstone, cascadeCanyonDelete } from "../sync/mirrorStore";
import { getSyncDb, notifyMirrorChanged, withSyncTransaction } from "../sync/syncDb";

/** Cached blobs of rows we just dropped. Best-effort, outside the transaction —
 *  the same order deltaPull uses. */
async function unlinkAll(paths: string[]): Promise<void> {
  for (const path of paths) {
    await deleteAsync(path, { idempotent: true }).catch(() => {});
  }
}

/**
 * Stop seeing a canyon someone shared with you.
 *
 * The cascade is the local half of `shareRevokeTombstones` (api/src/lib/
 * syncTombstones.ts): the canyon takes its canyon-level media and its linked
 * route with it, because those were only ever visible through this share.
 */
export async function removeSharedCanyon(canyonId: string): Promise<void> {
  await unshareCanyon(canyonId, "me");
  const db = await getSyncDb();
  const orphaned = await withSyncTransaction(db, () =>
    cascadeCanyonDelete(db, canyonId),
  );
  notifyMirrorChanged();
  await unlinkAll(orphaned);
}

/**
 * Stop seeing a waypoint, route, LiDAR topo or GeoPDF shared with you directly.
 *
 * Only ever called where `sharedRowVisibility` says "direct": a waypoint or
 * route that is on this phone because it is LINKED to a shared canyon has no
 * share row of its own, and the server would answer 404. Those are removed by
 * removing the canyon, which is what the sheets point at instead.
 *
 * Topo and GeoPDF jobs are not delta-synced entities, so there is nothing in
 * the mirror to drop — their lists refetch.
 */
export async function removeSharedEntity(
  entityType: SharableEntityType,
  entityId: string,
): Promise<void> {
  await unshareItem(entityType, entityId, "me");
  if (entityType !== "waypoint" && entityType !== "route") return;
  const db = await getSyncDb();
  const orphaned = await withSyncTransaction(db, () =>
    applyTombstone(db, { type: entityType, id: entityId }),
  );
  notifyMirrorChanged();
  await unlinkAll(orphaned);
}
