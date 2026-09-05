// Waypoint ↔ place linking. The sibling of lib/routeLink.ts, and it exists
// for the same reason: a link is a VISIBILITY change, so it has to write
// tombstones, and there are two write paths (PATCH /waypoints/:id and the sync
// push handler) that must not drift.
//
// The difference from routes is the whole difficulty. A route belongs to at
// most one place, so unlinking it always revokes the sharees of that place.
// A waypoint is many-to-many — one carpark serves three places off the same
// trailhead — so a user may be able to see one waypoint through SEVERAL shared
// places at once. Unlinking it from one of them revokes nothing for that user;
// the other path is still open. Tombstoning on the naive "sharees of the place
// we just left" rule would delete a waypoint from a mirror that is still
// entitled to it, and the row would not come back until the next full reset.
//
// So every revocation here is computed as a DIFF: who could see it before,
// minus who can still see it after. That is `waypointVisibilityLoss`, and it is
// the only correct way to answer the question — every caller goes through it.

import { Prisma } from "@prisma/client";
import { AppError } from "../middleware/errorHandler";
import prisma from "../services/prisma";
import { writeTombstones, waypointRevokeTombstones } from "./syncTombstones";

/**
 * Who can see which waypoints through a place share, at one instant.
 * waypointId → the sharee user ids. Never includes the owner, who sees their
 * own waypoints unconditionally and must never be tombstoned for one.
 */
export type WaypointVisibilitySnapshot = Map<string, Set<string>>;

/**
 * Every visibility change is a two-phase call, and BOTH halves run inside the
 * caller's transaction:
 *
 *   const before = await snapshotWaypointVisibility(tx, ids);
 *   ...the destructive write (unlink / share revoke / place delete)...
 *   await writeWaypointVisibilityLoss(tx, before);
 *
 * Snapshot first because the rows that granted sight are what the write
 * destroys — afterwards the question is unanswerable. Diff second because only
 * the difference is a real revocation under many-to-many links.
 */
export async function snapshotWaypointVisibility(
  tx: Prisma.TransactionClient,
  waypointIds: string[],
): Promise<WaypointVisibilitySnapshot> {
  const snapshot: WaypointVisibilitySnapshot = new Map(
    waypointIds.map((id) => [id, new Set<string>()]),
  );
  if (waypointIds.length === 0) return snapshot;
  const links = await tx.placeWaypoint.findMany({
    where: { waypointId: { in: waypointIds } },
    select: {
      waypointId: true,
      place: { select: { shares: { select: { sharedWithId: true } } } },
    },
  });
  for (const link of links) {
    const viewers = snapshot.get(link.waypointId);
    if (!viewers) continue;
    for (const share of link.place.shares) viewers.add(share.sharedWithId);
  }
  return snapshot;
}

/** Snapshot every waypoint linked to `placeId` — the set a place delete or a
 * share revocation puts at risk. Call BEFORE the write. */
export async function snapshotPlaceWaypointVisibility(
  tx: Prisma.TransactionClient,
  placeId: string,
): Promise<WaypointVisibilitySnapshot> {
  const links = await tx.placeWaypoint.findMany({
    where: { placeId },
    select: { waypointId: true },
  });
  return snapshotWaypointVisibility(
    tx,
    links.map((link) => link.waypointId),
  );
}

/**
 * Diff `before` against the world as it now stands and tombstone exactly the
 * users who lost their last path to each waypoint. Call AFTER the write.
 *
 * This is the m2m guard: a user who still reaches the waypoint through another
 * shared place is absent from the result and keeps their mirrored copy.
 */
export async function writeWaypointVisibilityLoss(
  tx: Prisma.TransactionClient,
  before: WaypointVisibilitySnapshot,
): Promise<void> {
  const atRisk = [...before]
    .filter(([, viewers]) => viewers.size > 0)
    .map(([waypointId]) => waypointId);
  if (atRisk.length === 0) return;

  const after = await snapshotWaypointVisibility(tx, atRisk);
  for (const waypointId of atRisk) {
    const stillVisible = after.get(waypointId) ?? new Set<string>();
    const lost = [...before.get(waypointId)!].filter(
      (userId) => !stillVisible.has(userId),
    );
    await writeTombstones(tx, waypointRevokeTombstones({ waypointId, userIds: lost }));
  }
}

/**
 * Replace a waypoint's place links with `placeIds`, emitting tombstones for
 * exactly the users the change costs.
 *
 * The caller must already have verified that the waypoint is owned by the
 * caller and that every place in `placeIds` is too (resolveWaypointPlaceIds
 * below) — an owner-scoped lookup belongs in the route layer, not here.
 */
export async function applyWaypointPlaceLinks(
  tx: Prisma.TransactionClient,
  args: { waypointId: string; placeIds: string[] },
): Promise<void> {
  const { waypointId, placeIds } = args;

  const before = await snapshotWaypointVisibility(tx, [waypointId]);

  // Explicit empty case: an empty `notIn` is a footgun to rely on, and this is
  // the "unlink everything" path, which is exactly when it must not misfire.
  await tx.placeWaypoint.deleteMany({
    where:
      placeIds.length === 0
        ? { waypointId }
        : { waypointId, placeId: { notIn: placeIds } },
  });
  if (placeIds.length > 0) {
    await tx.placeWaypoint.createMany({
      data: placeIds.map((placeId) => ({ placeId, waypointId })),
      skipDuplicates: true,
    });
  }

  await writeWaypointVisibilityLoss(tx, before);
}

/**
 * Resolve a placeIds list to link: every id must be a place OWNED by the
 * caller. The owner-scoped lookup makes a foreign id indistinguishable from a
 * nonexistent one (no existence oracle), mirroring resolveRoutePlaceId.
 *
 * The shape is already validated in shared/waypointValidation.ts; this is the
 * authorization half, which only the server can answer.
 */
export async function resolveWaypointPlaceIds(
  userId: string,
  placeIds: string[],
): Promise<string[]> {
  if (placeIds.length === 0) return [];
  const owned = await prisma.place.findMany({
    where: { id: { in: placeIds }, ownerId: userId },
    select: { id: true },
  });
  if (owned.length !== placeIds.length) {
    throw new AppError(400, "Place not found");
  }
  return placeIds;
}

// ── Wire shape ───────────────────────────────────────────────────────────────
// One serializer for BOTH surfaces that emit a waypoint (routes/waypoints.ts
// and the delta/push in routes/sync.ts). Two copies of a visibility-scoped
// serializer is exactly how SEC-001 happened.

export const waypointInclude = {
  placeLinks: { select: { placeId: true } },
} satisfies Prisma.WaypointInclude;

export type WaypointWithLinks = Prisma.WaypointGetPayload<{
  include: typeof waypointInclude;
}>;

/**
 * Serialize for `userId`. `placeIds` is SCOPED to places the caller can see:
 * a sharee given the carpark must not learn, from its link list, the existence
 * of every other place the owner filed it under — the same rule that keeps
 * owner-private aggregates off sharee-reachable payloads.
 *
 * `sharedPlaceIds` is ignored for an owner (who sees all their own links), so
 * owner-only callers may pass an empty set.
 */
export function serializeWaypointFor(
  waypoint: WaypointWithLinks,
  userId: string,
  sharedPlaceIds: Set<string>,
  /**
   * Direct-share recipient counts, keyed by waypoint id — see shareCountsFor.
   * OMITTED (not zero) when absent, because the write paths below have no map
   * to consult and a fabricated 0 would tell the client a waypoint with three
   * recipients has none. Absent means "unchanged"; only the delta is
   * authoritative for this field.
   */
  sharedCounts?: Map<string, number>,
) {
  const { placeLinks, placeId: _legacyPlaceId, ...fields } = waypoint;
  const isOwner = waypoint.ownerId === userId;
  const ids = placeLinks.map((link) => link.placeId);
  return {
    ...fields,
    syncRole: isOwner ? ("owner" as const) : ("shared" as const),
    placeIds: isOwner ? ids : ids.filter((id) => sharedPlaceIds.has(id)),
    // Owner-only: a share fan-out is owner-private derived cardinality (root
    // CLAUDE.md). Telling a recipient how many OTHER people hold the thing
    // they were given leaks the owner's sharing behaviour.
    ...(isOwner && sharedCounts
      ? { sharedCount: sharedCounts.get(waypoint.id) ?? 0 }
      : {}),
  };
}

/** Sugar for the owner-only write paths, which have no share set to consult. */
export function serializeOwnWaypoint(waypoint: WaypointWithLinks) {
  return serializeWaypointFor(waypoint, waypoint.ownerId, new Set());
}
