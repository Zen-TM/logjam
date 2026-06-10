import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";

const router = Router();

// Notification payloads store ONLY reference IDs — no denormalised plaintext
// canyon names or usernames (PRIV-005). Display strings are resolved from the
// live rows at read time below:
//   friend_request / friend_request_accepted: payload.friendshipId (+ counterpart username)
//   canyon_shared:                            payload.canyonId, payload.sharedById (+ canyonName, sharedByUsername)
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

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: [
        { read: "asc" }, // unread first
        { createdAt: "desc" }, // newest first within each group
      ],
      take: 500,
    });

    const friendshipIds = new Set<string>();
    const canyonIds = new Set<string>();
    const sharerIds = new Set<string>();
    for (const n of notifications) {
      if (n.type === "friend_request" || n.type === "friend_request_accepted") {
        const id = payloadString(n.payload, "friendshipId");
        if (id) friendshipIds.add(id);
      } else if (n.type === "canyon_shared") {
        const id = payloadString(n.payload, "canyonId");
        if (id) canyonIds.add(id);
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
      if (n.type === "canyon_shared") {
        const id = payloadString(n.payload, "canyonId");
        const canyon = id ? canyonById.get(id) : undefined;
        if (!canyon) return [];
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
    const notification = await prisma.notification.findUnique({
      where: { id },
    });
    if (!notification) throw new AppError(404, "Notification not found");
    if (notification.userId !== user.id)
      throw new AppError(403, "Access denied");

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
    const notification = await prisma.notification.findUnique({
      where: { id },
    });
    if (!notification) throw new AppError(404, "Notification not found");
    if (notification.userId !== user.id)
      throw new AppError(403, "Access denied");

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
