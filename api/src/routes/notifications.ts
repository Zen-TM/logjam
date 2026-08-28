import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";

const router = Router();

// Server-side cap on the notifications list. The true total (see X-Total-Count
// below) lets the client show a truncation caption when this cap bites (UX-002).
const NOTIFICATIONS_LIST_CAP = 500;

// Notification payloads store ONLY reference IDs — no denormalised plaintext
// canyon names or usernames (PRIV-005). Display strings are resolved from the
// live rows at read time below:
//   friend_request / friend_request_accepted: payload.friendshipId (+ counterpart username)
//   canyon_shared:                            payload.canyonId, payload.sharedById (+ canyonName, sharedByUsername)
//   item_shared:                              payload.entityType, payload.entityId, payload.sharedById (+ sharedByUsername)
//   file_sent:                                payload.fileSendId, payload.sentById (+ sentByUsername)
//   topo_complete / topo_failed / *_export:   self-only refs (jobId, jobName, footprint)
// When the referenced canyon/share/friendship is gone (share revoked, canyon
// deleted, friendship removed, or the other user's account deleted), there is
// nothing to resolve, so the notification is dropped at read time and never
// leaks a stale name (PRIV-001/003). Opportunistic row deletion on revoke/
// delete (sharing.ts, friends.ts, canyons.ts, users.ts) is the primary
// cleanup; this read-time drop is the fallback.
function payloadString(payload: unknown, key: string): string | null {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

// ── GET /notifications ────────────────────────────────────────
// Returns all notifications for the current user, unread first
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: [
          { read: "asc" }, // unread first
          { createdAt: "desc" }, // newest first within each group
        ],
        take: NOTIFICATIONS_LIST_CAP,
      }),
      prisma.notification.count({ where: { userId: user.id } }),
    ]);

    const friendshipIds = new Set<string>();
    const canyonIds = new Set<string>();
    const sharerIds = new Set<string>();
    const sharedItems: { entityType: string; entityId: string }[] = [];
    const fileSendIds = new Set<string>();
    for (const n of notifications) {
      if (n.type === "friend_request" || n.type === "friend_request_accepted") {
        const id = payloadString(n.payload, "friendshipId");
        if (id) friendshipIds.add(id);
      } else if (n.type === "canyon_shared") {
        const id = payloadString(n.payload, "canyonId");
        if (id) canyonIds.add(id);
        const sharedById = payloadString(n.payload, "sharedById");
        if (sharedById) sharerIds.add(sharedById);
      } else if (n.type === "file_sent") {
        const id = payloadString(n.payload, "fileSendId");
        if (id) fileSendIds.add(id);
        const sentById = payloadString(n.payload, "sentById");
        if (sentById) sharerIds.add(sentById);
      } else if (n.type === "item_shared") {
        const entityType = payloadString(n.payload, "entityType");
        const entityId = payloadString(n.payload, "entityId");
        if (entityType && entityId) sharedItems.push({ entityType, entityId });
        // No name is resolved for a directly-shared item: the client already
        // has the row through delta sync (waypoint/route) or its own list
        // endpoint (topo/GeoPDF job), and resolving one here would mean
        // reading a waypoint name into a notification payload for no gain.
        const sharedById = payloadString(n.payload, "sharedById");
        if (sharedById) sharerIds.add(sharedById);
      }
    }

    // Resolve display strings (canyon names, usernames) from the LIVE rows at
    // read time. Nothing is persisted in the payload (PRIV-005), so a revoked
    // share, deleted canyon, or removed friendship simply has no row to resolve
    // and the notification is dropped below (PRIV-001/003).
    const [existingFriendships, existingCanyons, sharerUsers] = await Promise.all([
      friendshipIds.size > 0
        ? prisma.friendship.findMany({
            where: { id: { in: [...friendshipIds] } },
            select: {
              id: true,
              requesterId: true,
              addresseeId: true,
              requester: { select: { id: true, username: true } },
              addressee: { select: { id: true, username: true } },
            },
          })
        : Promise.resolve(
            [] as {
              id: string;
              requesterId: string;
              addresseeId: string;
              requester: { id: string; username: string };
              addressee: { id: string; username: string };
            }[],
          ),
      canyonIds.size > 0
        ? prisma.canyon.findMany({
            where: { id: { in: [...canyonIds] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      sharerIds.size > 0
        ? prisma.user.findMany({
            where: { id: { in: [...sharerIds] } },
            select: { id: true, username: true },
          })
        : Promise.resolve([] as { id: string; username: string }[]),
    ]);

    const friendshipById = new Map(existingFriendships.map((f) => [f.id, f]));
    const canyonById = new Map(existingCanyons.map((c) => [c.id, c]));
    const sharerById = new Map(sharerUsers.map((u) => [u.id, u]));

    // Which item_shared notifications still have a live Share row for this
    // recipient. A revoked share resolves to nothing and the notification is
    // dropped below (PRIV-001/003), mirroring the canyon_shared rule.
    const liveShares =
      sharedItems.length > 0
        ? await prisma.share.findMany({
            where: { sharedWithId: user.id, OR: sharedItems },
            select: { entityType: true, entityId: true },
          })
        : [];
    const liveShareKeys = new Set(
      liveShares.map((row) => `${row.entityType}:${row.entityId}:${user.id}`),
    );

    // The canyon twin of liveShareKeys. The canyon row OUTLIVES its share (it
    // stays alive under its owner), so "the canyon still exists" is not the
    // same question as "this recipient may still see its name" — checking only
    // existence made the documented read-time fallback unable to catch a
    // revoked canyon share (APIR-012/PRIV-103).
    const liveCanyonShares =
      canyonIds.size > 0
        ? await prisma.canyonShare.findMany({
            where: { sharedWithId: user.id, canyonId: { in: [...canyonIds] } },
            select: { canyonId: true },
          })
        : [];
    const liveCanyonShareIds = new Set(
      liveCanyonShares.map((row) => row.canyonId),
    );

    // Which file_sent notifications still have a live, non-declined recipient
    // row. A swept (expired) send or a declined one resolves to nothing and the
    // notification is dropped below, exactly as a revoked share is. Note this
    // is NOT a revocation: the file was a copy and an accepted recipient keeps
    // it — only the notification stops being resolvable.
    const liveFileSends =
      fileSendIds.size > 0
        ? await prisma.fileSendRecipient.findMany({
            where: {
              userId: user.id,
              fileSendId: { in: [...fileSendIds] },
              status: { not: "declined" },
            },
            select: { fileSendId: true },
          })
        : [];
    const liveFileSendIds = new Set(
      liveFileSends.map((row) => row.fileSendId),
    );

    const visible = notifications.flatMap((n) => {
      if (n.type === "friend_request" || n.type === "friend_request_accepted") {
        const id = payloadString(n.payload, "friendshipId");
        const friendship = id ? friendshipById.get(id) : undefined;
        if (!friendship) return [];
        // The counterpart is whichever party of the friendship is NOT the
        // recipient of this notification.
        const counterpart =
          friendship.requesterId === user.id
            ? friendship.addressee
            : friendship.requester;
        const usernameKey =
          n.type === "friend_request"
            ? "requesterUsername"
            : "acceptedByUsername";
        return [
          {
            ...n,
            payload: { ...(n.payload as object), [usernameKey]: counterpart.username },
          },
        ];
      }
      if (n.type === "file_sent") {
        const id = payloadString(n.payload, "fileSendId");
        if (!id || !liveFileSendIds.has(id)) return [];
        const sentById = payloadString(n.payload, "sentById");
        const sender = sentById ? sharerById.get(sentById) : undefined;
        return [
          {
            ...n,
            payload: {
              ...(n.payload as object),
              ...(sender ? { sentByUsername: sender.username } : {}),
            },
          },
        ];
      }
      if (n.type === "item_shared") {
        // Dropped when the share is gone, exactly as canyon_shared is: the
        // revoke deletes the row opportunistically, and this is the fallback.
        const entityType = payloadString(n.payload, "entityType");
        const entityId = payloadString(n.payload, "entityId");
        if (!entityType || !entityId) return [];
        if (!liveShareKeys.has(`${entityType}:${entityId}:${user.id}`)) return [];
        const sharedById = payloadString(n.payload, "sharedById");
        const sharer = sharedById ? sharerById.get(sharedById) : undefined;
        return [
          {
            ...n,
            payload: {
              ...(n.payload as object),
              ...(sharer ? { sharedByUsername: sharer.username } : {}),
            },
          },
        ];
      }
      if (n.type === "canyon_shared") {
        const id = payloadString(n.payload, "canyonId");
        const canyon = id ? canyonById.get(id) : undefined;
        // Both halves: the canyon must still exist AND still be shared with
        // this recipient, exactly as item_shared requires a live Share row.
        if (!canyon || !liveCanyonShareIds.has(canyon.id)) return [];
        const sharedById = payloadString(n.payload, "sharedById");
        const sharer = sharedById ? sharerById.get(sharedById) : undefined;
        return [
          {
            ...n,
            payload: {
              ...(n.payload as object),
              canyonName: canyon.name,
              ...(sharer ? { sharedByUsername: sharer.username } : {}),
            },
          },
        ];
      }
      return [n];
    });

    // True total (pre-cap) so the client can flag a truncated view (UX-002).
    res.set("X-Total-Count", String(total));
    res.json(visible);
  },
);

// ── GET /notifications/unread-count ───────────────────────────
// Returns the count of unread notifications (for badge display)
router.get(
  "/unread-count",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const count = await prisma.notification.count({
      where: { userId: user.id, read: false },
    });

    res.json({ count });
  },
);

// ── PATCH /notifications/:id/read ─────────────────────────────
// Mark a single notification as read
router.patch(
  "/:id/read",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    // Owner-scoped lookup: a foreign id gets the SAME 404 a non-existent one
    // gets, so the status cannot confirm that a notification id exists to
    // anyone but its owner (house anti-oracle rule, PRIV-105).
    const notification = await prisma.notification.findFirst({
      where: { id, userId: user.id },
    });
    if (!notification) throw new AppError(404, "Notification not found");

    const updated = await prisma.notification.update({
      where: { id },
      data: { read: true },
    });

    res.json(updated);
  },
);

// ── PATCH /notifications/read-all ─────────────────────────────
// Mark all notifications as read
router.patch(
  "/read-all",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    await prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });

    res.status(204).send();
  },
);

// ── DELETE /notifications/:id ─────────────────────────────────
// Delete a single notification
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    // Owner-scoped, same reason as PATCH /:id/read above (PRIV-105).
    const notification = await prisma.notification.findFirst({
      where: { id, userId: user.id },
    });
    if (!notification) throw new AppError(404, "Notification not found");

    await prisma.notification.delete({ where: { id } });

    res.status(204).send();
  },
);

// ── DELETE /notifications ─────────────────────────────────────
// Clear all read notifications
router.delete(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    await prisma.notification.deleteMany({
      where: { userId: user.id, read: true },
    });

    res.status(204).send();
  },
);

export default router;
