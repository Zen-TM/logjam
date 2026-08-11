// Waypoint ↔ canyon linking. The sibling of lib/routeLink.ts, and it exists
// for the same reason: a link is a VISIBILITY change, so it has to write
// tombstones, and there are two write paths (PATCH /waypoints/:id and the sync
// push handler) that must not drift.
//
// The difference from routes is the whole difficulty. A route belongs to at
// most one canyon, so unlinking it always revokes the sharees of that canyon.
// A waypoint is many-to-many — one carpark serves three canyons off the same
// trailhead — so a user may be able to see one waypoint through SEVERAL shared
// canyons at once. Unlinking it from one of them revokes nothing for that user;
// the other path is still open. Tombstoning on the naive "sharees of the canyon
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
 * Who can see which waypoints through a canyon share, at one instant.
 * waypointId → the sharee user ids. Never includes the owner, who sees their
 * own waypoints unconditionally and must never be tombstoned for one.
 */
export type WaypointVisibilitySnapshot = Map<string, Set<string>>;

/**
 * Every visibility change is a two-phase call, and BOTH halves run inside the
 * caller's transaction:
 *
 *   const before = await snapshotWaypointVisibility(tx, ids);
 *   ...the destructive write (unlink / share revoke / canyon delete)...
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
  const links = await tx.canyonWaypoint.findMany({
    where: { waypointId: { in: waypointIds } },
    select: {
      waypointId: true,
      canyon: { select: { shares: { select: { sharedWithId: true } } } },
    },
  });
  for (const link of links) {
    const viewers = snapshot.get(link.waypointId);
    if (!viewers) continue;
    for (const share of link.canyon.shares) viewers.add(share.sharedWithId);
  }
  return snapshot;
}

/** Snapshot every waypoint linked to `canyonId` — the set a canyon delete or a
 * share revocation puts at risk. Call BEFORE the write. */
export async function snapshotCanyonWaypointVisibility(
  tx: Prisma.TransactionClient,
  canyonId: string,
): Promise<WaypointVisibilitySnapshot> {
  const links = await tx.canyonWaypoint.findMany({
    where: { canyonId },
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
 * shared canyon is absent from the result and keeps their mirrored copy.
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
 * Replace a waypoint's canyon links with `canyonIds`, emitting tombstones for
 * exactly the users the change costs.
 *
 * The caller must already have verified that the waypoint is owned by the
 * caller and that every canyon in `canyonIds` is too (resolveWaypointCanyonIds
 * below) — an owner-scoped lookup belongs in the route layer, not here.
 */
export async function applyWaypointCanyonLinks(
  tx: Prisma.TransactionClient,
  args: { waypointId: string; canyonIds: string[] },
): Promise<void> {
  const { waypointId, canyonIds } = args;

  const before = await snapshotWaypointVisibility(tx, [waypointId]);

  // Explicit empty case: an empty `notIn` is a footgun to rely on, and this is
  // the "unlink everything" path, which is exactly when it must not misfire.
  await tx.canyonWaypoint.deleteMany({
    where:
      canyonIds.length === 0
        ? { waypointId }
        : { waypointId, canyonId: { notIn: canyonIds } },
  });
  if (canyonIds.length > 0) {
    await tx.canyonWaypoint.createMany({
      data: canyonIds.map((canyonId) => ({ canyonId, waypointId })),
      skipDuplicates: true,
    });
  }

  await writeWaypointVisibilityLoss(tx, before);
}

/**
 * Resolve a canyonIds list to link: every id must be a canyon OWNED by the
 * caller. The owner-scoped lookup makes a foreign id indistinguishable from a
 * nonexistent one (no existence oracle), mirroring resolveRouteCanyonId.
 *
 * The shape is already validated in shared/waypointValidation.ts; this is the
 * authorization half, which only the server can answer.
 */
export async function resolveWaypointCanyonIds(
  userId: string,
  canyonIds: string[],
): Promise<string[]> {
  if (canyonIds.length === 0) return [];
  const owned = await prisma.canyon.findMany({
    where: { id: { in: canyonIds }, ownerId: userId },
    select: { id: true },
  });
  if (owned.length !== canyonIds.length) {
    throw new AppError(400, "Canyon not found");
  }
  return canyonIds;
}

// ── Wire shape ───────────────────────────────────────────────────────────────
// One serializer for BOTH surfaces that emit a waypoint (routes/waypoints.ts
// and the delta/push in routes/sync.ts). Two copies of a visibility-scoped
// serializer is exactly how SEC-001 happened.

export const waypointInclude = {
  canyonLinks: { select: { canyonId: true } },
} satisfies Prisma.WaypointInclude;

export type WaypointWithLinks = Prisma.WaypointGetPayload<{
  include: typeof waypointInclude;
}>;

/**
 * Serialize for `userId`. `canyonIds` is SCOPED to canyons the caller can see:
 * a sharee given the carpark must not learn, from its link list, the existence
 * of every other canyon the owner filed it under — the same rule that keeps
 * owner-private aggregates off sharee-reachable payloads.
 *
 * `sharedCanyonIds` is ignored for an owner (who sees all their own links), so
 * owner-only callers may pass an empty set.
 */
export function serializeWaypointFor(
  waypoint: WaypointWithLinks,
  userId: string,
  sharedCanyonIds: Set<string>,
) {
  const { canyonLinks, canyonId: _legacyCanyonId, ...fields } = waypoint;
  const isOwner = waypoint.ownerId === userId;
  const ids = canyonLinks.map((link) => link.canyonId);
  return {
    ...fields,
    syncRole: isOwner ? ("owner" as const) : ("shared" as const),
    canyonIds: isOwner ? ids : ids.filter((id) => sharedCanyonIds.has(id)),
  };
}

/** Sugar for the owner-only write paths, which have no share set to consult. */
export function serializeOwnWaypoint(waypoint: WaypointWithLinks) {
  return serializeWaypointFor(waypoint, waypoint.ownerId, new Set());
}
