import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import { NOTIFICATIONS_LIST_CAP } from "@logjam/shared";

const router = Router();

// The list cap is shared: the true total (see X-Total-Count below) lets a
// client show a truncation caption when the cap bites (UX-002), and
// `notificationsTruncated` is how both clients decide that it did.

// Notification payloads store ONLY reference IDs — no denormalised plaintext
// place names or usernames (PRIV-005). Display strings are resolved from the
// live rows at read time below:
//   friend_request / friend_request_accepted: payload.friendshipId (+ counterpart username)
//   place_shared:                            payload.placeId, payload.sharedById (+ placeName, sharedByUsername)
//   item_shared:                              payload.entityType, payload.entityId, payload.sharedById (+ sharedByUsername)
//   file_sent:                                payload.fileSendId, payload.sentById (+ sentByUsername, filename, fileSendStatus)
//     — filename is resolved from the live send while one exists. The single
//       exception to "ids only" in this table: when a send EXPIRES unsaved the
//       reaper stamps the filename into the payload before deleting the last
//       copy of it (lib/fileSendReaper.ts), because the recipient is owed the
//       name of the file they missed. Nothing else ever writes it.
//   topo_complete / topo_failed / *_export:   self-only refs (jobId, jobName, footprint)
// When the referenced place/share/friendship is gone (share revoked, place
// deleted, friendship removed, or the other user's account deleted), there is
// nothing to resolve, so the notification is dropped at read time and never
// leaks a stale name (PRIV-001/003). Opportunistic row deletion on revoke/
// delete (sharing.ts, friends.ts, places.ts, users.ts) is the primary
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
    const placeIds = new Set<string>();
    const sharerIds = new Set<string>();
    const sharedItems: { entityType: string; entityId: string }[] = [];
    const fileSendIds = new Set<string>();
    for (const n of notifications) {
      if (n.type === "friend_request" || n.type === "friend_request_accepted") {
        const id = payloadString(n.payload, "friendshipId");
        if (id) friendshipIds.add(id);
      } else if (n.type === "place_shared") {
        const id = payloadString(n.payload, "placeId");
        if (id) placeIds.add(id);
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

    // Resolve display strings (place names, usernames) from the LIVE rows at
    // read time. Nothing is persisted in the payload (PRIV-005), so a revoked
    // share, deleted place, or removed friendship simply has no row to resolve
    // and the notification is dropped below (PRIV-001/003).
    const [existingFriendships, existingPlaces, sharerUsers] = await Promise.all([
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
      placeIds.size > 0
        ? prisma.place.findMany({
            where: { id: { in: [...placeIds] } },
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
    const placeById = new Map(existingPlaces.map((c) => [c.id, c]));
    const sharerById = new Map(sharerUsers.map((u) => [u.id, u]));

    // Which item_shared notifications still have a live Share row for this
    // recipient. A revoked share resolves to nothing and the notification is
    // dropped below (PRIV-001/003), mirroring the place_shared rule.
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

    // The place twin of liveShareKeys. The place row OUTLIVES its share (it
    // stays alive under its owner), so "the place still exists" is not the
    // same question as "this recipient may still see its name" — checking only
    // existence made the documented read-time fallback unable to catch a
    // revoked place share (APIR-012/PRIV-103).
    const livePlaceShares =
      placeIds.size > 0
        ? await prisma.placeShare.findMany({
            where: { sharedWithId: user.id, placeId: { in: [...placeIds] } },
            select: { placeId: true },
          })
        : [];
    const livePlaceShareIds = new Set(
      livePlaceShares.map((row) => row.placeId),
    );

    // Which file_sent notifications still have a live, non-declined recipient
    // row. A swept (expired) send or a declined one resolves to nothing and the
    // notification is dropped below, exactly as a revoked share is. Note this
    // is NOT a revocation: the file was a copy and an accepted recipient keeps
    // it — only the notification stops being resolvable.
    //
    // DELIBERATELY WIDER than `inboxWhere`: this keeps EXPIRED sends, which the
    // inbox endpoint drops. A send that lapsed before the recipient saved it is
    // the one expiry worth reporting — without it the offer simply vanishes and
    // the user is left knowing a friend sent them something they cannot find.
    // The invariant that matters is not "the two queries agree" but "a
    // notification never offers a button the endpoint would refuse", and it is
    // held below instead: an expired row is labelled `expired`, and the client
    // renders no actions for that (`shared/src/notificationActions.ts`).
    // Declined is still excluded here — that notification is deleted outright
    // at decline time, and a user who said no is not owed a reminder.
    const liveFileSends =
      fileSendIds.size > 0
        ? await prisma.fileSendRecipient.findMany({
            where: {
              userId: user.id,
              status: { not: "declined" },
              fileSendId: { in: [...fileSendIds] },
            },
            // The filename is resolved from the live row like every other
            // display string here (PRIV-005 — nothing denormalised into the
            // stored payload). The recipient is entitled to know WHAT they are
            // being offered before they accept it, and it is the one piece of
            // user text on a send: rendered, never logged.
            select: {
              fileSendId: true,
              status: true,
              fileSend: { select: { filename: true, expiresAt: true } },
            },
          })
        : [];
    const liveFileSendById = new Map(
      liveFileSends.map((row) => [row.fileSendId, row]),
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
        const recipientRow = id ? liveFileSendById.get(id) : undefined;
        const sentByIdEarly = payloadString(n.payload, "sentById");
        const senderEarly = sentByIdEarly ? sharerById.get(sentByIdEarly) : undefined;
        if (!recipientRow) {
          // NO ROW, BUT THE NOTIFICATION SURVIVED — and that combination means
          // exactly one thing: the reaper swept an expired send this user never
          // saved. Every other way a recipient row disappears takes the
          // notification with it in the same transaction (decline in
          // routes/fileSends.ts, unfriending in lib/shareAccess.ts, account
          // deletion in routes/users.ts), and the reaper itself deletes the
          // notifications of recipients who DID save the file
          // (lib/fileSendReaper.ts). So this branch is the lapsed offer, and
          // saying so is the whole point: without it a file a friend sent you
          // simply vanishes and you are left looking for it.
          //
          // The filename comes from the payload here, not from a row — the
          // reaper stamped it on the way past (see the header). It is the only
          // notification kind that carries one at rest, and only in this state.
          // A send swept before that behaviour existed has none, and the label
          // degrades to "a file" rather than inventing one.
          if (!senderEarly) return [];
          return [
            {
              ...n,
              payload: {
                ...(n.payload as object),
                fileSendStatus: "expired",
                sentByUsername: senderEarly.username,
              },
            },
          ];
        }
        const expired = recipientRow.fileSend.expiresAt.getTime() <= Date.now();
        // An ACCEPTED send that has since lapsed is dropped, not reported: the
        // recipient already has the file on their device, so "this expired"
        // would be news about nothing. Only a send they never took is worth
        // explaining.
        if (expired && recipientRow.status === "accepted") return [];
        const sentById = payloadString(n.payload, "sentById");
        const sender = sentById ? sharerById.get(sentById) : undefined;
        return [
          {
            ...n,
            payload: {
              ...(n.payload as object),
              filename: recipientRow.fileSend.filename,
              // "accepted" means the download URL was ISSUED, not that the
              // transfer landed, so the client keeps offering the download —
              // it is the row's state, not a completion. "expired" is a state
              // the row itself does not carry: it is the send's clock, and it
              // means offer nothing and say why.
              fileSendStatus: expired ? "expired" : recipientRow.status,
              ...(sender ? { sentByUsername: sender.username } : {}),
            },
          },
        ];
      }
      if (n.type === "item_shared") {
        // Dropped when the share is gone, exactly as place_shared is: the
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
      if (n.type === "place_shared") {
        const id = payloadString(n.payload, "placeId");
        const place = id ? placeById.get(id) : undefined;
        // Both halves: the place must still exist AND still be shared with
        // this recipient, exactly as item_shared requires a live Share row.
        if (!place || !livePlaceShareIds.has(place.id)) return [];
        const sharedById = payloadString(n.payload, "sharedById");
        const sharer = sharedById ? sharerById.get(sharedById) : undefined;
        return [
          {
            ...n,
            payload: {
              ...(n.payload as object),
              placeName: place.name,
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
// Mark a single notification read, or unread again with `{ "read": false }` —
// the REST twin of the sync push's markRead / markUnread ops, for Logjam Web.
// Anything but a boolean `read` (including no body) marks it read, as before.
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

    const read = req.body?.read === false ? false : true;
    const updated = await prisma.notification.update({
      where: { id },
      data: { read },
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
