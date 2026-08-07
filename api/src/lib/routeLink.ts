// Route ↔ canyon linking: the one rule in the routes feature that isn't a
// straight copy of the waypoint CRUD shape.
//
// A canyon holds AT MOST ONE route (Route.canyonId is @unique). Linking a
// route to an occupied canyon therefore has to displace the incumbent — and it
// does so by UNLINKING it, never deleting it. The displaced route survives as
// a standalone route. Nothing a user drew is destroyed by a link; the UI warns
// first and names what will move.
//
// The visibility consequence is the part that is easy to miss: a linked route
// is visible to everyone the canyon is shared with (it follows canyon-level
// MEDIA, not the owner-private waypoint rule). So an unlink silently REVOKES
// sharee visibility with no delete anywhere, and must emit tombstones for the
// displaced route exactly as a delete would. Both this and the delete path
// live here so the rule has one home; PATCH /routes/:id and the sync push
// handler both call it.

import { Prisma } from "@prisma/client";
import { parseRouteAnchors } from "@logjam/shared";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { writeTombstones, routeUnlinkTombstones } from "./syncTombstones";

/**
 * Anchor indices for a validated point list, or SQL NULL.
 *
 * Lives here rather than in the route handler because there are TWO write
 * paths — PATCH /routes/:id and the sync push op — and only one of them used
 * to apply this rule. The other accepted `anchors`, validated it, and then
 * silently dropped it on the floor, so every route drawn on a phone lost the
 * user's own vertices on the first pull after it flushed.
 *
 * validateRoutePayload has already rejected a malformed list, so this only
 * re-parses for the normalised numbers. Null means "no record", which is a
 * legitimate state (routes drawn before snapping existed) rather than a
 * failure, and the client reads it as every point being the user's own.
 *
 * DbNull, not JsonNull: "no anchor record" is the absence of a value, so it
 * belongs in the column as SQL NULL rather than the JSON literal `null`.
 * Postgres distinguishes the two and only the former reads back as null.
 */
export function parseAnchorsOrNull(
  value: unknown,
  pointCount: number,
): number[] | typeof Prisma.DbNull {
  const parsed = parseRouteAnchors(value, pointCount);
  const anchors = "error" in parsed ? null : parsed.anchors;
  return anchors ?? Prisma.DbNull;
}

/** Sharee user ids for a canyon — who loses sight of a route unlinked from it. */
export async function canyonShareeIds(
  tx: Prisma.TransactionClient,
  canyonId: string,
): Promise<string[]> {
  const shares = await tx.canyonShare.findMany({
    where: { canyonId },
    select: { sharedWithId: true },
  });
  return shares.map((share) => share.sharedWithId);
}

export type RouteLinkResult = {
  /** The route that was pushed out of the slot, if any — so the caller can
   * tell the user which one moved. */
  displacedRoute: { id: string; name: string } | null;
};

/**
 * Apply a canyonId change for `routeId` inside `tx`, displacing any incumbent
 * and writing the tombstones the visibility change requires.
 *
 * `canyonId === null` unlinks. The caller must already have verified that the
 * route is owned by the caller and that the canyon (when non-null) is too —
 * resolving a canyon association is an owner-scoped lookup that belongs in the
 * route layer (resolveRouteCanyonId below), not here.
 */
export async function applyRouteCanyonLink(
  tx: Prisma.TransactionClient,
  args: {
    routeId: string;
    canyonId: string | null;
    /** Current canyonId of the route being moved, to detect a no-op. */
    currentCanyonId: string | null;
  },
): Promise<RouteLinkResult> {
  const { routeId, canyonId, currentCanyonId } = args;

  if (canyonId === currentCanyonId) return { displacedRoute: null };

  // Leaving a canyon: its sharees lose this route.
  if (currentCanyonId !== null) {
    const shareeIds = await canyonShareeIds(tx, currentCanyonId);
    await writeTombstones(tx, routeUnlinkTombstones({ routeId, shareeIds }));
  }

  let displacedRoute: { id: string; name: string } | null = null;
  if (canyonId !== null) {
    // Displace the incumbent BEFORE claiming the slot — the unique index would
    // otherwise reject the update. Scoped to the caller's own routes: a canyon
    // they own can only hold a route they own, so a row here is always theirs.
    const incumbent = await tx.route.findUnique({
      where: { canyonId },
      select: { id: true, name: true, ownerId: true },
    });
    if (incumbent && incumbent.id !== routeId) {
      await tx.route.update({
        where: { id: incumbent.id },
        data: { canyonId: null },
      });
      // The incumbent leaves the same canyon, so the same sharees lose it.
      const shareeIds = await canyonShareeIds(tx, canyonId);
      await writeTombstones(
        tx,
        routeUnlinkTombstones({ routeId: incumbent.id, shareeIds }),
      );
      displacedRoute = { id: incumbent.id, name: incumbent.name };
    }
  }

  await tx.route.update({ where: { id: routeId }, data: { canyonId } });
  return { displacedRoute };
}

/**
 * Resolve an optional canyonId association: must be a canyon OWNED by the
 * caller. The owner-scoped lookup makes a foreign id indistinguishable from a
 * nonexistent one (no existence oracle), mirroring resolveCanyonAssociation in
 * routes/waypoints.ts.
 *
 * undefined → undefined (PATCH: leave unchanged); null → null (clears).
 */
export async function resolveRouteCanyonId(
  userId: string,
  canyonId: unknown,
): Promise<string | null | undefined> {
  if (canyonId === undefined) return undefined;
  if (canyonId === null) return null;
  if (typeof canyonId !== "string") {
    throw new AppError(400, "canyonId must be a string or null");
  }
  const owned = await prisma.canyon.count({
    where: { id: canyonId, ownerId: userId },
  });
  if (owned !== 1) throw new AppError(400, "Canyon not found");
  return canyonId;
}
