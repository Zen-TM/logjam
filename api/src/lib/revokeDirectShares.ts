// Taking back a `Share` row — the ONE implementation, for one row or for
// eighty.
//
// This used to live inline in DELETE /shares/:entityType/:entityId/:userId, and
// then DELETE /friends/:id/shares needed the same four steps over a list. Four
// steps is three too many to write twice:
//
//   1. delete the share row(s);
//   2. purge each recipient's residual `item_shared` notification (PRIV-001 —
//      the read-time filter already hides it, but a revoked share must not
//      leave a row at rest);
//   3. bump the entity's `updatedAt` so the OWNER's other devices re-pull it
//      and refresh their now-stale `sharedCount` (a grant does the same — see
//      `touchSharedForDelta` below, which both halves now share);
//   4. tombstone the recipient — but ONLY where no other path to the row
//      survives.
//
// STEP 4 IS THE WHOLE REASON THIS IS NOT A `deleteMany`. A waypoint or route
// can be visible for two unrelated reasons (lib/shareAccess.ts): a direct
// `Share` row, or a link to a canyon shared with that recipient. Revoking the
// direct arm leaves the canyon arm standing, so tombstoning unconditionally
// would tell the recipient to forget a row the next delta pull re-delivers —
// and the row would flicker out and back on every sweep.
//
// Jobs (topo, GeoPDF) are not delta-synced at all: their lists refetch, so they
// get steps 1-2 and nothing else.
//
// AUTHORIZATION IS THE CALLER'S. Nothing here decides who may revoke what:
// routes/shares.ts vets owner-or-recipient via `loadEntityRole`, and
// routes/friends.ts derives its list from ownership itself. This function
// writes what it is given.
//
// PRIVACY: counts, never names. Nothing here logs.
import type { Prisma } from "@prisma/client";
import type { SharableEntityType } from "@logjam/shared";

import prisma from "../services/prisma";
import { hasCanyonInheritedAccess } from "./shareAccess";
import { directShareRevokeTombstones, writeTombstones } from "./syncTombstones";

/** One (thing, recipient) grant to take back. */
export type DirectShareRevocation = {
  entityType: SharableEntityType;
  entityId: string;
  sharedWithId: string;
};

/** The two kinds that ride delta sync, and therefore need a tombstone. */
export function syncedEntityType(
  entityType: SharableEntityType,
): "waypoint" | "route" | null {
  return entityType === "waypoint" || entityType === "route" ? entityType : null;
}

/** The key `stillVisible` is read by — one revocation, one entry. */
export function revocationKey(revocation: DirectShareRevocation): string {
  return `${revocation.entityType}:${revocation.entityId}:${revocation.sharedWithId}`;
}

/**
 * Which revocations must tell the recipient to forget the row.
 *
 * Pure, so the branch that matters is testable without a database: a job is
 * never tombstoned (it is not delta-synced), and a waypoint or route is
 * tombstoned only for a recipient left with NO surviving path to it.
 */
export function revocationsNeedingTombstones(
  revocations: DirectShareRevocation[],
  /** Keys (from `revocationKey`) whose recipient still sees the row via a shared canyon. */
  stillVisible: ReadonlySet<string>,
): DirectShareRevocation[] {
  return revocations.filter(
    (revocation) =>
      syncedEntityType(revocation.entityType) !== null &&
      !stillVisible.has(revocationKey(revocation)),
  );
}

/**
 * Bump shared rows' `updatedAt` so a visibility CHANGE reaches the devices that
 * care. Shared-row deltas are a WHERE-restriction layered over
 * `updatedAt > since`, so neither a grant nor a revoke moves a watermark on its
 * own — a granted row would simply be absent from the recipient's next page
 * until the owner happened to edit it. Exported because the GRANT paths need
 * exactly the same bump (routes/shares.ts, lib/bulkShare.ts's callers).
 */
export async function touchSharedForDelta(
  tx: Prisma.TransactionClient,
  entityType: SharableEntityType,
  entityIds: string[],
): Promise<void> {
  if (entityIds.length === 0) return;
  if (entityType === "waypoint") {
    await tx.waypoint.updateMany({
      where: { id: { in: entityIds } },
      data: { updatedAt: new Date() },
    });
  } else if (entityType === "route") {
    await tx.route.updateMany({
      where: { id: { in: entityIds } },
      data: { updatedAt: new Date() },
    });
  }
}

/**
 * Revoke the given direct shares in one transaction. Returns how many share
 * rows actually went — a pair that had already been revoked counts 0 rather
 * than failing the batch, because a list built a minute ago may name one.
 *
 * The inherited-visibility reads happen BEFORE the transaction, deliberately:
 * this deletes no canyon row, so a recipient's canyon arm cannot change across
 * it.
 */
export async function revokeDirectShares(
  revocations: DirectShareRevocation[],
): Promise<number> {
  if (revocations.length === 0) return 0;

  const stillVisible = new Set<string>();
  await Promise.all(
    revocations.map(async (revocation) => {
      const synced = syncedEntityType(revocation.entityType);
      if (synced === null) return;
      if (
        await hasCanyonInheritedAccess(
          revocation.sharedWithId,
          synced,
          revocation.entityId,
        )
      ) {
        stillVisible.add(revocationKey(revocation));
      }
    }),
  );

  const tombstoned = revocationsNeedingTombstones(revocations, stillVisible);
  const touchedIdsByType = new Map<SharableEntityType, string[]>();
  for (const revocation of revocations) {
    const list = touchedIdsByType.get(revocation.entityType) ?? [];
    if (!list.includes(revocation.entityId)) list.push(revocation.entityId);
    touchedIdsByType.set(revocation.entityType, list);
  }

  return await prisma.$transaction(async (tx) => {
    const { count } = await tx.share.deleteMany({
      where: {
        OR: revocations.map((revocation) => ({
          entityType: revocation.entityType,
          entityId: revocation.entityId,
          sharedWithId: revocation.sharedWithId,
        })),
      },
    });

    for (const revocation of revocations) {
      await tx.notification.deleteMany({
        where: {
          userId: revocation.sharedWithId,
          type: "item_shared",
          payload: { path: ["entityId"], equals: revocation.entityId },
        },
      });
    }

    for (const [entityType, entityIds] of touchedIdsByType) {
      await touchSharedForDelta(tx, entityType, entityIds);
    }

    await writeTombstones(
      tx,
      tombstoned.flatMap((revocation) =>
        directShareRevokeTombstones({
          // Narrowed by `revocationsNeedingTombstones`; the cast is the price of
          // Array.filter not carrying the predicate through.
          entityType: syncedEntityType(revocation.entityType)!,
          entityId: revocation.entityId,
          userIds: [revocation.sharedWithId],
        }),
      ),
    );

    return count;
  });
}
