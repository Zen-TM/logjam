// Route ↔ place linking: the one rule in the routes feature that isn't a
// straight copy of the waypoint CRUD shape.
//
// A place holds AT MOST ONE route (Route.placeId is @unique). Linking a
// route to an occupied place therefore has to displace the incumbent — and it
// does so by UNLINKING it, never deleting it. The displaced route survives as
// a standalone route. Nothing a user drew is destroyed by a link; the UI warns
// first and names what will move.
//
// The visibility consequence is the part that is easy to miss: a linked route
// is visible to everyone the place is shared with (it follows place-level
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

/** Sharee user ids for a place — who loses sight of a route unlinked from it. */
export async function placeShareeIds(
  tx: Prisma.TransactionClient,
  placeId: string,
): Promise<string[]> {
  const shares = await tx.placeShare.findMany({
    where: { placeId },
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
 * Apply a placeId change for `routeId` inside `tx`, displacing any incumbent
 * and writing the tombstones the visibility change requires.
 *
 * `placeId === null` unlinks. The caller must already have verified that the
 * route is owned by the caller and that the place (when non-null) is too —
 * resolving a place association is an owner-scoped lookup that belongs in the
 * route layer (resolveRoutePlaceId below), not here.
 */
export async function applyRoutePlaceLink(
  tx: Prisma.TransactionClient,
  args: {
    routeId: string;
    placeId: string | null;
    /** Current placeId of the route being moved, to detect a no-op. */
    currentPlaceId: string | null;
  },
): Promise<RouteLinkResult> {
  const { routeId, placeId, currentPlaceId } = args;

  if (placeId === currentPlaceId) return { displacedRoute: null };

  // Leaving a place: its sharees lose this route.
  if (currentPlaceId !== null) {
    const shareeIds = await placeShareeIds(tx, currentPlaceId);
    await writeTombstones(tx, routeUnlinkTombstones({ routeId, shareeIds }));
  }

  let displacedRoute: { id: string; name: string } | null = null;
  if (placeId !== null) {
    // Displace the incumbent BEFORE claiming the slot — the unique index would
    // otherwise reject the update. Scoped to the caller's own routes: a place
    // they own can only hold a route they own, so a row here is always theirs.
    const incumbent = await tx.route.findUnique({
      where: { placeId },
      select: { id: true, name: true, ownerId: true },
    });
    if (incumbent && incumbent.id !== routeId) {
      await tx.route.update({
        where: { id: incumbent.id },
        data: { placeId: null },
      });
      // The incumbent leaves the same place, so the same sharees lose it.
      const shareeIds = await placeShareeIds(tx, placeId);
      await writeTombstones(
        tx,
        routeUnlinkTombstones({ routeId: incumbent.id, shareeIds }),
      );
      displacedRoute = { id: incumbent.id, name: incumbent.name };
    }
  }

  await tx.route.update({ where: { id: routeId }, data: { placeId } });
  return { displacedRoute };
}

/**
 * Resolve an optional placeId association: must be a place OWNED by the
 * caller. The owner-scoped lookup makes a foreign id indistinguishable from a
 * nonexistent one (no existence oracle), mirroring resolvePlaceAssociation in
 * routes/waypoints.ts.
 *
 * undefined → undefined (PATCH: leave unchanged); null → null (clears).
 */
export async function resolveRoutePlaceId(
  userId: string,
  placeId: unknown,
): Promise<string | null | undefined> {
  if (placeId === undefined) return undefined;
  if (placeId === null) return null;
  if (typeof placeId !== "string") {
    throw new AppError(400, "placeId must be a string or null");
  }
  const owned = await prisma.place.count({
    where: { id: placeId, ownerId: userId },
  });
  if (owned !== 1) throw new AppError(400, "Place not found");
  return placeId;
}
