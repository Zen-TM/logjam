// Direct, per-item sharing — the non-canyon sibling of routes/sharing.ts.
//
// A Share row is a LIVE, REVOCABLE view of a record the sender still owns:
// waypoints, routes, LiDAR topo jobs, GeoPDF jobs. Recipients read and export;
// they never edit, and the owner can take it back. That is a different promise
// from "send a copy" (FileSend), and the two must never be worded alike —
// see the header of shared/src/sharing.ts.
//
// Every access decision here comes from lib/shareAccess.ts. Nothing in this
// file re-derives an owner or share check inline (SEC-001), and denials follow
// the house anti-oracle rule: no access → 404, sharee attempting an
// owner-only action → 403.
import { Router, Response } from "express";

import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import { normalizeUserUiPreferences } from "@logjam/shared";
import { sendPushToUser } from "../services/push";
import {
  loadEntityRole,
  parseSharableEntityType,
  requireEntityOwner,
} from "../lib/shareAccess";
import {
  revokeDirectShares,
  touchSharedForDelta,
} from "../lib/revokeDirectShares";
import type { SharableEntityType } from "@logjam/shared";

const router = Router();

// ── POST /shares ──────────────────────────────────────────────
// Share one item with one friend. Body: { entityType, entityId, sharedWithUserId }
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = await resolveUser(req.user!.sub);
  const body = req.body ?? {};

  const entityType = parseSharableEntityType(body.entityType);
  const entityId = typeof body.entityId === "string" ? body.entityId : "";
  if (!entityId) throw new AppError(400, "entityId is required");
  const { sharedWithUserId } = body;
  if (!sharedWithUserId || typeof sharedWithUserId !== "string") {
    throw new AppError(400, "sharedWithUserId is required");
  }

  // Owner-only, decided by shareAccess. A stranger gets the same 404 a
  // non-existent id gets; a sharee re-sharing gets 403.
  await requireEntityOwner(
    user.id,
    entityType,
    entityId,
    "Only the owner can share this item",
  );

  if (sharedWithUserId === user.id) {
    throw new AppError(400, "You already own this item");
  }

  // Friends only — same rule canyon sharing enforces, and checked BEFORE the
  // target-user lookup so an unknown id and an existing non-friend get the
  // same 403 rather than 404-vs-403 (PRIV-101).
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: "accepted",
      OR: [
        { requesterId: user.id, addresseeId: sharedWithUserId },
        { requesterId: sharedWithUserId, addresseeId: user.id },
      ],
    },
  });
  if (!friendship) {
    throw new AppError(403, "You can only share items with friends");
  }

  // Unreachable given the friendship above; kept so a missing row fails loud
  // rather than reading preferences off undefined.
  const targetUser = await prisma.user.findUnique({
    where: { id: sharedWithUserId },
  });
  if (!targetUser) throw new AppError(404, "Target user not found");

  const existing = await prisma.share.findUnique({
    where: {
      entityType_entityId_sharedWithId: {
        entityType,
        entityId,
        sharedWithId: sharedWithUserId,
      },
    },
  });
  if (existing) throw new AppError(409, "Already shared with this user");

  const notifyRecipient = normalizeUserUiPreferences(targetUser.uiPreferences)
    .notifications.shareInApp;

  const share = await prisma.$transaction(async (tx) => {
    const created = await tx.share.create({
      data: {
        entityType,
        entityId,
        sharedById: user.id,
        sharedWithId: sharedWithUserId,
      },
    });
    await touchSharedForDelta(tx, entityType, [entityId]);
    if (notifyRecipient) {
      // Reference IDs ONLY — never a waypoint/route name or any coordinate in
      // a notification payload (PRIV-005). Display strings are resolved from
      // the live rows at read time in notifications.ts, so a revoked share has
      // nothing left to resolve and surfaces no stale name.
      await tx.notification.create({
        data: {
          userId: sharedWithUserId,
          type: "item_shared",
          payload: { entityType, entityId, sharedById: user.id },
        },
      });
    }
    return created;
  });

  if (notifyRecipient) {
    // Best-effort push after commit; generic title + opaque ids only.
    void sendPushToUser(sharedWithUserId, {
      type: "item_shared",
      entityType,
      entityId,
    });
  }

  res.status(201).json(share);
});

// ── DELETE /shares/:entityType/:entityId/:userId ──────────────
// Revoke. Callable by the owner, or by the recipient removing their own access
// ("me" alias, matching the canyon revoke).
router.delete(
  "/:entityType/:entityId/:userId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const entityType = parseSharableEntityType(getParam(req.params.entityType));
    const entityId = getParam(req.params.entityId);
    const rawUserId = getParam(req.params.userId);
    const targetUserId = rawUserId === "me" ? user.id : rawUserId;

    // Authorize BEFORE looking the share up, so the response cannot become an
    // existence oracle for an (entityId, targetUserId) pair. A caller who is
    // neither the owner nor the named recipient gets the same 404 as a
    // non-existent entity — they cannot distinguish "shared with X" from "not".
    const loaded = await loadEntityRole(user.id, entityType, entityId);
    const isOwner = loaded?.role === "owner";
    const isRecipient = targetUserId === user.id;
    if (!loaded || (!isOwner && !isRecipient)) {
      throw new AppError(404, "Item not found");
    }

    const share = await prisma.share.findUnique({
      where: {
        entityType_entityId_sharedWithId: {
          entityType,
          entityId,
          sharedWithId: targetUserId,
        },
      },
    });
    if (!share) throw new AppError(404, "Share not found");

    // Everything the revoke has to do — the row, the recipient's residual
    // notification, the delta bump and the conditional tombstone — is
    // lib/revokeDirectShares.ts, shared with the per-friend bulk revoke
    // (DELETE /friends/:id/shares). One row here, a list there.
    await revokeDirectShares([
      { entityType, entityId, sharedWithId: targetUserId },
    ]);

    res.status(204).send();
  },
);

// ── GET /shares/:entityType/:entityId ─────────────────────────
// Who this item is shared with. Owner only — a recipient must never be able to
// enumerate co-recipients (the §4.6.1 rule canyon shares already follow).
router.get(
  "/:entityType/:entityId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const entityType = parseSharableEntityType(getParam(req.params.entityType));
    const entityId = getParam(req.params.entityId);

    await requireEntityOwner(
      user.id,
      entityType,
      entityId,
      "Only the owner can view shares",
    );

    const shares = await prisma.share.findMany({
      where: { entityType, entityId },
      include: {
        // Username-only: email on a friends/sharing surface is a regression
        // (root CLAUDE.md).
        sharedWith: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json(shares);
  },
);

export default router;
