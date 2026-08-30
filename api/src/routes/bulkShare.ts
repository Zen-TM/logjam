// POST /bulk-share — ONE user action, "share these things with these friends",
// across every kind of thing and both sharing tables.
//
// WHY A DEDICATED ENDPOINT rather than a client loop over POST /shares: 23
// items x 3 friends is 69 requests, 69 transactions and 69 pushes. The limiter
// (300/60s, per-IP) would survive it and the recipient's phone would not.
// Here it is one transaction, one `createMany` per table, and ONE push per
// recipient.
//
// IT IS ALSO THE END OF THE ACTION, INCLUDING THE COPIES. A bulk share can
// contain items that cannot be shared at all, only sent as a file (a recorded
// track, an imported GPX) — those go through POST /file-sends/:id/confirm one
// upload at a time, carrying the same `batchId`, and each of those confirms
// stays silent. The client calls THIS endpoint last, so the single push lands
// after the uploads it is announcing. `copyCount` is how it says that a
// copy-only action still deserves that push.
//
// WHAT IT DOES NOT DO: revoke. Bulk revoke belongs on the friend, not the item
// list ("everything I've shared with alice"), and needs a reverse index this
// endpoint has no part of.
//
// PRIVACY: recipients are accepted friends (lib/friendRecipients.ts, the same
// guard sending a file runs). The response is COUNTS — never a per-id verdict,
// which would confirm to a caller that an id they guessed exists (SEC-001).
// Notification payloads carry ids only, as the single-item paths do (PRIV-005).
import { Router, Response } from "express";

import { Prisma } from "@prisma/client";
import {
  MAX_BULK_SHARE_ITEMS,
  normalizeUserUiPreferences,
  type BulkShareItemType,
  type SharableEntityType,
} from "@logjam/shared";

import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { resolveUser } from "../lib/resolveUser";
import { sendPushToUser } from "../services/push";
import { parseClientSuppliedId } from "../lib/clientSuppliedId";
import { parseFriendRecipientIds } from "../lib/friendRecipients";
import { filterOwnedEntityIds } from "../lib/shareAccess";
import { filterOwnedCanyonIds } from "../lib/canyonAccess";
import {
  parseBulkShareItems,
  planBulkShare,
  sharePairKey,
  type BulkShareGrant,
} from "../lib/bulkShare";

const router = Router();

/** The same bound one send carries, and for the same reason. */
const MAX_RECIPIENTS = 25;

/** The `Share`-table types — everything in the union except canyons. */
function isEntityType(
  entityType: BulkShareItemType,
): entityType is SharableEntityType {
  return entityType !== "canyon";
}

/**
 * How many copies this action is also sending, declared by the client.
 *
 * It gates ONE thing: whether a bulk with no shares in it still fires a push.
 * Nothing is written from it and nothing is authorized by it, so an inflated
 * number buys the caller a push to their own friends and nothing else.
 */
function parseCopyCount(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppError(400, "copyCount must be a non-negative integer");
  }
  return value;
}

router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = await resolveUser(req.user!.sub);
  const body = req.body ?? {};

  const items = parseBulkShareItems(body.items);
  const copyCount = parseCopyCount(body.copyCount);
  if (items.length === 0 && copyCount === 0) {
    throw new AppError(400, "A bulk share must contain something");
  }
  // REQUIRED, unlike the optional batchId on a file-send confirm: this endpoint
  // exists to be the grouped action, and a batch of notifications with no key
  // to group on is 23 separate rows in the recipient's inbox — the exact thing
  // the feature is for. UUIDv4-shaped, like every other client-minted id
  // (lib/clientSuppliedId.ts).
  const batchId = parseClientSuppliedId(body.batchId, "batchId");
  if (!batchId) throw new AppError(400, "batchId is required");

  const recipientIds = await parseFriendRecipientIds({
    senderId: user.id,
    value: body.recipientIds,
    maxRecipients: MAX_RECIPIENTS,
    tooManyMessage: `You can share with at most ${MAX_RECIPIENTS} friends at once`,
    selfMessage: "You cannot share with yourself",
    notFriendsMessage: "You can only share with friends",
  });

  // ── What is actually the sender's to give ──────────────────────────────
  // Batched by type: five queries at most, whatever the list length. The owner
  // rule itself stays in canyonAccess/shareAccess — nothing here re-derives it
  // (SEC-001), which is why those two grew a batch form rather than this file
  // growing a `WHERE ownerId` of its own.
  const idsByType = new Map<BulkShareItemType, string[]>();
  for (const item of items) {
    const list = idsByType.get(item.entityType) ?? [];
    list.push(item.entityId);
    idsByType.set(item.entityType, list);
  }
  const ownedIdsByType = new Map<BulkShareItemType, Set<string>>();
  await Promise.all(
    [...idsByType].map(async ([entityType, ids]) => {
      const owned = isEntityType(entityType)
        ? await filterOwnedEntityIds(user.id, entityType, ids)
        : await filterOwnedCanyonIds(user.id, ids);
      ownedIdsByType.set(entityType, owned);
    }),
  );

  // ── What the recipients already have ───────────────────────────────────
  // Re-sharing is a no-op, never a 409: a bulk selection routinely overlaps
  // what a friend was given last week, and failing the action over that would
  // make the feature unusable. Read OUTSIDE the transaction and reconciled by
  // `skipDuplicates` inside it — the read is for the COUNT the user is shown;
  // the unique constraint is what actually keeps the rows honest.
  const entityIdsByType = [...idsByType].filter(([entityType]) =>
    isEntityType(entityType),
  );
  const canyonIds = idsByType.get("canyon") ?? [];
  const [existingShares, existingCanyonShares] = await Promise.all([
    entityIdsByType.length > 0
      ? prisma.share.findMany({
          where: {
            sharedWithId: { in: recipientIds },
            OR: entityIdsByType.map(([entityType, ids]) => ({
              entityType,
              entityId: { in: ids },
            })),
          },
          select: { entityType: true, entityId: true, sharedWithId: true },
        })
      : Promise.resolve([]),
    canyonIds.length > 0
      ? prisma.canyonShare.findMany({
          where: {
            canyonId: { in: canyonIds },
            sharedWithId: { in: recipientIds },
          },
          select: { canyonId: true, sharedWithId: true },
        })
      : Promise.resolve([]),
  ]);
  const existingPairKeys = new Set([
    ...existingShares.map((row) =>
      sharePairKey(
        row.entityType as BulkShareItemType,
        row.entityId,
        row.sharedWithId,
      ),
    ),
    ...existingCanyonShares.map((row) =>
      sharePairKey("canyon", row.canyonId, row.sharedWithId),
    ),
  ]);

  const plan = planBulkShare({
    items,
    recipientIds,
    ownedIdsByType,
    existingPairKeys,
  });

  // Who wants to hear about it. Same preference the single-item paths read.
  const recipientPrefs = await prisma.user.findMany({
    where: { id: { in: recipientIds } },
    select: { id: true, uiPreferences: true },
  });
  const notifiable = new Set(
    recipientPrefs
      .filter(
        (row) =>
          normalizeUserUiPreferences(row.uiPreferences).notifications.shareInApp,
      )
      .map((row) => row.id),
  );

  if (plan.grants.length > 0) {
    await prisma.$transaction(async (tx) => {
      const canyonGrants = plan.grants.filter(
        (grant) => grant.entityType === "canyon",
      );
      const entityGrants = plan.grants.filter(
        (grant) => grant.entityType !== "canyon",
      );

      if (entityGrants.length > 0) {
        await tx.share.createMany({
          data: entityGrants.map((grant) => ({
            entityType: grant.entityType,
            entityId: grant.entityId,
            sharedById: user.id,
            sharedWithId: grant.sharedWithId,
          })),
          // A concurrent single-item share of the same pair loses the race
          // rather than 500-ing the whole bulk. The read above is what the
          // user's counts come from; this is what keeps the write safe.
          skipDuplicates: true,
        });
      }
      if (canyonGrants.length > 0) {
        await tx.canyonShare.createMany({
          data: canyonGrants.map((grant) => ({
            canyonId: grant.entityId,
            sharedById: user.id,
            sharedWithId: grant.sharedWithId,
          })),
          skipDuplicates: true,
        });
      }

      // Move the watermark, or delta sync never delivers what was just granted
      // (the long note on `touchedIdsByType` in lib/bulkShare.ts). One
      // `updateMany` per type, not one update per row.
      const now = new Date();
      for (const [entityType, ids] of plan.touchedIdsByType) {
        if (entityType === "waypoint") {
          await tx.waypoint.updateMany({
            where: { id: { in: ids } },
            data: { updatedAt: now },
          });
        } else if (entityType === "route") {
          await tx.route.updateMany({
            where: { id: { in: ids } },
            data: { updatedAt: now },
          });
        } else if (entityType === "canyon") {
          await tx.canyon.updateMany({
            where: { id: { in: ids } },
            data: { updatedAt: now },
          });
        }
        // Topo and GeoPDF jobs are fetched through their own list endpoints and
        // reconcile on the next fetch — they are not delta-synced at all.
      }

      // ONE ROW PER ITEM PER RECIPIENT, grouped by `batchId` on the way out.
      //
      // NOT one aggregate row per batch, which is the shape this obviously
      // wants: the inbox row for a shared item is what the read-time resolver
      // drops when the share is revoked (PRIV-001/003), and a single row
      // holding 23 ids would have to partially resolve, recount its own label
      // and delete itself at zero. Per-item rows keep that logic exactly as it
      // is, and the client collapses them on `batchId` for display.
      //
      // Ids only, as ever (PRIV-005) — the display strings are resolved from
      // the live rows in routes/notifications.ts.
      const notifications = plan.grants
        .filter((grant) => notifiable.has(grant.sharedWithId))
        .map((grant) => notificationFor(grant, user.id, batchId));
      if (notifications.length > 0) {
        await tx.notification.createMany({ data: notifications });
      }
    });
  }

  // ONE PUSH PER RECIPIENT for the whole action — the copies included, which is
  // why the client calls this last. Best-effort after commit, generic title,
  // opaque batch id only.
  if (plan.result.granted > 0 || copyCount > 0) {
    for (const recipientId of recipientIds) {
      if (notifiable.has(recipientId)) {
        void sendPushToUser(recipientId, { type: "bulk_shared", batchId });
      }
    }
  }

  res.status(200).json(plan.result);
});

/**
 * The notification for one grant. A canyon share and a direct share are
 * different types with different payload keys — the same split the two
 * single-item routes make, kept identical so `notifications.ts` needs no new
 * branch to resolve a bulk-created row.
 */
function notificationFor(
  grant: BulkShareGrant,
  sharedById: string,
  batchId: string,
): Prisma.NotificationCreateManyInput {
  if (grant.entityType === "canyon") {
    return {
      userId: grant.sharedWithId,
      type: "canyon_shared",
      payload: { canyonId: grant.entityId, sharedById, batchId },
    };
  }
  return {
    userId: grant.sharedWithId,
    type: "item_shared",
    payload: {
      entityType: grant.entityType,
      entityId: grant.entityId,
      sharedById,
      batchId,
    },
  };
}

export default router;
