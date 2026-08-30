// "These user ids are my accepted friends" — the recipient guard every
// fan-out verb runs before it hands anything over.
//
// Extracted from routes/fileSends.ts when bulk sharing became a second caller.
// The rule it enforces is one of the privacy constraints (root CLAUDE.md:
// sharing is explicit, between authenticated users who have agreed to be
// friends), so it must not exist twice and drift.
//
// A non-friend in the list fails the WHOLE request rather than being silently
// dropped: a partial fan-out the user was never told about is worse than an
// error, and worse still for bulk, where "23 items to 3 friends" quietly
// becoming "23 items to 2 friends" is invisible on the sender's screen.
//
// PRIVACY: the failure is 403 for both an unknown user id and an existing
// non-friend, and the friendship is checked BEFORE any user-row lookup, so the
// status cannot distinguish "no such user" from "not your friend" (PRIV-101).
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";

/**
 * Validate a recipient id list. Returns the ids, deduped, order not preserved
 * beyond first-seen (a `Set` round-trip).
 *
 * `maxRecipients` is the caller's own bound — a send and a bulk share cap for
 * different reasons and neither number belongs to this file.
 */
export async function parseFriendRecipientIds({
  senderId,
  value,
  maxRecipients,
  tooManyMessage,
  selfMessage,
  notFriendsMessage,
}: {
  senderId: string;
  value: unknown;
  maxRecipients: number;
  tooManyMessage: string;
  selfMessage: string;
  notFriendsMessage: string;
}): Promise<string[]> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError(400, "recipientIds is required");
  }
  if (value.length > maxRecipients) {
    throw new AppError(400, tooManyMessage);
  }
  const ids = [...new Set(value)];
  if (
    !ids.every((id): id is string => typeof id === "string" && id.length > 0)
  ) {
    throw new AppError(400, "recipientIds must be user ids");
  }
  if (ids.includes(senderId)) {
    throw new AppError(400, selfMessage);
  }

  const friendships = await prisma.friendship.findMany({
    where: {
      status: "accepted",
      OR: [
        { requesterId: senderId, addresseeId: { in: ids } },
        { requesterId: { in: ids }, addresseeId: senderId },
      ],
    },
    select: { requesterId: true, addresseeId: true },
  });
  const friendIds = new Set(
    friendships.map((row) =>
      row.requesterId === senderId ? row.addresseeId : row.requesterId,
    ),
  );
  if (ids.some((id) => !friendIds.has(id))) {
    throw new AppError(403, notFriendsMessage);
  }
  return ids;
}
