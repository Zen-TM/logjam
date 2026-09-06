// Place ↔ place links: symmetric, stored once, owner-private.
//
// A link is NAVIGATIONAL ONLY. It grants no visibility to anyone — that is the
// rule that let lib/waypointLink.ts (219 lines of visibility diffing across a
// many-to-many) be deleted in the phase 1c fold. Sharing is always explicit,
// per place, through PlaceShare. A route is the exception that proves it: a
// route reaches a sharee through `Route.placeId`, a FOREIGN KEY, not a link.
//
// TWO WRITE PATHS, deliberately different shapes:
//
//   - The sync push op is per-link `create`/`delete` (routes/sync.ts). A link
//     has no fields, so there is no `update` and nothing to merge; two devices
//     linking the same pair collide on the unique index instead of clobbering
//     each other's whole list.
//   - The REST routes take a WHOLE LIST (`linkedPlaceIds` on POST/PATCH
//     /places), because that is the shape the web has always used for this and
//     the web is online-only: there is no offline window in which a stale list
//     could arrive and wipe an edit made elsewhere. This file is where the list
//     becomes rows, so both paths agree on ownership, canonical ordering and
//     tombstones.
//
//     ponytail: online-only removes the OFFLINE window, not the concurrency
//     one — two tabs, or web and phone at once, can still read → edit → save
//     with a stale list in hand and drop the loser's link silently. That is the
//     lost update fieldDefsStore.ts describes when it explains why definitions
//     left a whole-list PATCH. Two things keep it small and neither is
//     optional: the write below is a SET DIFFERENCE (add what is new, remove
//     what is absent) so an unrelated edit never churns link ids or their
//     tombstones, and both write paths land in this file. Upgrade path if the
//     web ever goes offline-capable: per-link add/remove REST endpoints, which
//     is what the sync ops already are.
//
// Removing a link needs a tombstone (the owner's OTHER devices hold the row and
// nothing else would tell them); adding one does not, because the new row rides
// the next delta on its own `updatedAt`.

import { Prisma } from "@prisma/client";
import { canonicalLinkPair, normalizeLinkedPlaceIds } from "@logjam/shared";

import { AppError } from "../middleware/errorHandler";
import prisma from "../services/prisma";
import { placeLinkDeleteTombstones, writeTombstones } from "./syncTombstones";

/**
 * The place ids a link list may name, validated and owner-scoped.
 *
 * A foreign or nonexistent id is the same 404 either way (404-not-403): the
 * response must not confirm that a place id exists to someone who cannot see
 * it. `self` is excluded because a place cannot be linked to itself.
 */
export async function resolveLinkedPlaceIds(
  ownerId: string,
  selfPlaceId: string,
  value: unknown,
): Promise<string[] | undefined> {
  const parsed = normalizeLinkedPlaceIds(value);
  if ("error" in parsed) throw new AppError(400, parsed.error);
  if (parsed.placeIds === undefined) return undefined;
  const placeIds = parsed.placeIds.filter((id) => id !== selfPlaceId);
  if (placeIds.length === 0) return [];
  const owned = await prisma.place.count({
    where: { id: { in: placeIds }, ownerId },
  });
  if (owned !== placeIds.length) throw new AppError(404, "Place not found");
  return placeIds;
}

/**
 * Make this place's link set exactly `linkedPlaceIds` — the whole-list write.
 *
 * Both endpoints are the owner's (`resolveLinkedPlaceIds` has checked), which
 * is what makes `PlaceLink.ownerId` trustworthy for every reader: the delta
 * filter, the tombstone fan-out and the "a link grants no visibility" rule all
 * read that column and none of them re-derives it.
 */
export async function applyPlaceLinks(
  tx: Prisma.TransactionClient,
  args: { ownerId: string; placeId: string; linkedPlaceIds: string[] },
): Promise<void> {
  const { ownerId, placeId, linkedPlaceIds } = args;
  const wanted = new Map(
    linkedPlaceIds.map((other) => {
      const pair = canonicalLinkPair(placeId, other);
      return [`${pair.aPlaceId}:${pair.bPlaceId}`, pair];
    }),
  );

  const existing = await tx.placeLink.findMany({
    where: { ownerId, OR: [{ aPlaceId: placeId }, { bPlaceId: placeId }] },
    select: { id: true, aPlaceId: true, bPlaceId: true },
  });

  const stale = existing.filter(
    (link) => !wanted.has(`${link.aPlaceId}:${link.bPlaceId}`),
  );
  if (stale.length > 0) {
    await tx.placeLink.deleteMany({
      where: { id: { in: stale.map((link) => link.id) } },
    });
    await writeTombstones(
      tx,
      placeLinkDeleteTombstones({ ownerId, linkIds: stale.map((l) => l.id) }),
    );
  }

  const held = new Set(
    existing.map((link) => `${link.aPlaceId}:${link.bPlaceId}`),
  );
  const missing = [...wanted].filter(([key]) => !held.has(key));
  if (missing.length > 0) {
    await tx.placeLink.createMany({
      data: missing.map(([, pair]) => ({ ownerId, ...pair })),
    });
  }
}

/**
 * The other end of every link touching each of `placeIds`, keyed by place id —
 * the read side of the whole-list shape.
 *
 * Owner-scoped, so a sharee's copy of a place carries an EMPTY list rather than
 * the owner's filing: they must never learn that the carpark they were shown
 * also sits under three places they cannot see.
 */
export async function linkedPlaceIdsFor(
  ownerId: string,
  placeIds: string[],
): Promise<Map<string, string[]>> {
  const byPlace = new Map<string, string[]>();
  if (placeIds.length === 0) return byPlace;
  const links = await prisma.placeLink.findMany({
    where: {
      ownerId,
      OR: [{ aPlaceId: { in: placeIds } }, { bPlaceId: { in: placeIds } }],
    },
    select: { aPlaceId: true, bPlaceId: true },
  });
  const wanted = new Set(placeIds);
  for (const link of links) {
    for (const [self, other] of [
      [link.aPlaceId, link.bPlaceId],
      [link.bPlaceId, link.aPlaceId],
    ]) {
      if (!wanted.has(self)) continue;
      byPlace.set(self, [...(byPlace.get(self) ?? []), other]);
    }
  }
  return byPlace;
}
