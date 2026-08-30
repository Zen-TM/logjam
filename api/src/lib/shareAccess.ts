// Single source of the DIRECT-share access decision, and the sibling of
// canyonAccess.ts. Read that file first — the 404-not-403 anti-oracle rule and
// the reasoning behind it are stated there and are identical here.
//
// The problem this file exists to solve: after direct sharing, a waypoint or
// route can be visible to a user for TWO unrelated reasons —
//
//   1. it is LINKED to a canyon that is shared with them (the pre-existing
//      rule: routes/waypoints inherit canyon-level visibility), or
//   2. it is shared with them DIRECTLY (a Share row).
//
// Any endpoint that answers half of that question answers it wrong. SEC-001
// was one inline re-derivation of a share check drifting from the real one;
// two legitimate sources of visibility is a strictly better setup for the same
// bug. So: nothing outside this file decides whether a user may see a
// waypoint, route, topo job or GeoPDF job.
//
// PRIVACY: denial is 404, never 403, for a user with no access — the status
// must not confirm that an id exists to someone who cannot see it. A recipient
// who legitimately sees the thing but is attempting an owner-only action gets
// 403, because for them the id's existence is not a secret.
import { Prisma } from "@prisma/client";

import { isSharableEntityType, type SharableEntityType } from "@logjam/shared";

import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { directShareRevokeTombstones, writeTombstones } from "./syncTombstones";

/**
 * "owner"  → full access, including edit/delete/share.
 * "shared" → read (and export) only, whether reached directly or via a canyon.
 * "none"   → no access; callers must render this as 404.
 */
export type ShareRole = "owner" | "shared" | "none";

/** Per-type "not found" text. Deliberately the same string a real miss gets. */
const NOT_FOUND_MESSAGE: Record<SharableEntityType, string> = {
  waypoint: "Waypoint not found",
  route: "Route not found",
  topoJob: "Topo job not found",
  geoPdfJob: "GeoPDF job not found",
};

/**
 * Does a direct Share row grant this user access to this entity?
 *
 * Split out so the canyon-inheritance branches below read as "direct OR
 * inherited" rather than burying the direct check inside each one.
 */
async function hasDirectShare(
  userId: string,
  entityType: SharableEntityType,
  entityId: string,
): Promise<boolean> {
  const share = await prisma.share.findUnique({
    where: {
      entityType_entityId_sharedWithId: {
        entityType,
        entityId,
        sharedWithId: userId,
      },
    },
    select: { id: true },
  });
  return share != null;
}

/**
 * A waypoint's role: owner, or shared either directly or through ANY canyon it
 * is linked to that the user can see.
 *
 * The canyon arm mirrors the delta-sync visibility rule in routes/sync.ts — a
 * waypoint linked to a shared canyon is part of that shared record. Both arms
 * live here so the two can never disagree.
 */
export async function getWaypointRole(
  userId: string,
  waypoint: { id: string; ownerId: string },
): Promise<ShareRole> {
  if (waypoint.ownerId === userId) return "owner";
  if (await hasDirectShare(userId, "waypoint", waypoint.id)) return "shared";
  return (await hasCanyonInheritedAccess(userId, "waypoint", waypoint.id))
    ? "shared"
    : "none";
}

/**
 * A route's role: owner, or shared either directly or through the canyon it is
 * linked to (Route.canyonId is a single nullable slot, so there is at most one
 * canyon to check).
 */
export async function getRouteRole(
  userId: string,
  route: { id: string; ownerId: string; canyonId: string | null },
): Promise<ShareRole> {
  if (route.ownerId === userId) return "owner";
  if (await hasDirectShare(userId, "route", route.id)) return "shared";
  return (await hasCanyonInheritedAccess(userId, "route", route.id))
    ? "shared"
    : "none";
}

/**
 * Whether `userId` still sees a synced entity through canyon inheritance,
 * INDEPENDENT of any direct Share row. A waypoint or route can be visible for
 * two reasons — a direct share OR a link to a canyon shared with the user — and
 * revoking the direct share must not tombstone a user who keeps the canyon arm.
 * This is the single source of that arm, so the role helpers above and the
 * revoke path can never disagree on it.
 */
export async function hasCanyonInheritedAccess(
  userId: string,
  entityType: "waypoint" | "route",
  entityId: string,
): Promise<boolean> {
  if (entityType === "waypoint") {
    const viaCanyon = await prisma.canyonWaypoint.findFirst({
      where: {
        waypointId: entityId,
        canyon: { shares: { some: { sharedWithId: userId } } },
      },
      select: { waypointId: true },
    });
    return viaCanyon != null;
  }
  const viaCanyon = await prisma.route.findFirst({
    where: {
      id: entityId,
      canyon: { shares: { some: { sharedWithId: userId } } },
    },
    select: { id: true },
  });
  return viaCanyon != null;
}

/**
 * A topo or GeoPDF job's role. These have no canyon link and never had any
 * visibility rule before direct sharing, so a Share row is the whole answer.
 */
export async function getJobRole(
  userId: string,
  entityType: "topoJob" | "geoPdfJob",
  job: { id: string; userId: string },
): Promise<ShareRole> {
  if (job.userId === userId) return "owner";
  return (await hasDirectShare(userId, entityType, job.id)) ? "shared" : "none";
}

/**
 * Assert read access, returning the resolved role so callers can shape an
 * owner-vs-sharee response. 404 on no access (see the header).
 */
export function requireShareAccess(
  role: ShareRole,
  entityType: SharableEntityType,
): Exclude<ShareRole, "none"> {
  if (role === "none") throw new AppError(404, NOT_FOUND_MESSAGE[entityType]);
  return role;
}

/**
 * Assert ownership, for the owner-only actions (edit, delete, share, list
 * recipients). Role-aware denial, exactly as requireCanyonOwnerAccess:
 *   none   → 404 (the caller cannot see this at all)
 *   shared → 403 (the caller sees it, but this action is not theirs)
 */
export function requireShareOwner(
  role: ShareRole,
  entityType: SharableEntityType,
  forbiddenMessage: string,
): void {
  if (role === "none") throw new AppError(404, NOT_FOUND_MESSAGE[entityType]);
  if (role !== "owner") throw new AppError(403, forbiddenMessage);
}

/**
 * The owner id and the caller's role for any sharable entity, whatever its
 * table. Returns null when the row does not exist — callers must render that
 * as the SAME 404 a "none" role gets, so a missing id and a hidden one are
 * indistinguishable from outside.
 *
 * The dispatcher lives here rather than in the share router so that "which
 * column holds the owner" (Waypoint.ownerId vs TopoJob.userId) is answered in
 * the one file that owns the access decision.
 */
export async function loadEntityRole(
  userId: string,
  entityType: SharableEntityType,
  entityId: string,
): Promise<{ ownerId: string; role: ShareRole } | null> {
  switch (entityType) {
    case "waypoint": {
      const row = await prisma.waypoint.findUnique({
        where: { id: entityId },
        select: { id: true, ownerId: true },
      });
      return row
        ? { ownerId: row.ownerId, role: await getWaypointRole(userId, row) }
        : null;
    }
    case "route": {
      const row = await prisma.route.findUnique({
        where: { id: entityId },
        select: { id: true, ownerId: true, canyonId: true },
      });
      return row
        ? { ownerId: row.ownerId, role: await getRouteRole(userId, row) }
        : null;
    }
    case "topoJob": {
      const row = await prisma.topoJob.findUnique({
        where: { id: entityId },
        select: { id: true, userId: true },
      });
      return row
        ? { ownerId: row.userId, role: await getJobRole(userId, "topoJob", row) }
        : null;
    }
    case "geoPdfJob": {
      const row = await prisma.geoPdfJob.findUnique({
        where: { id: entityId },
        select: { id: true, userId: true },
      });
      return row
        ? {
            ownerId: row.userId,
            role: await getJobRole(userId, "geoPdfJob", row),
          }
        : null;
    }
  }
}

/**
 * Load an entity and assert the caller OWNS it, for the owner-only share
 * actions. A non-existent id and one the caller cannot see both 404; a sharee
 * gets 403 (they can see it, they just may not re-share it).
 */
export async function requireEntityOwner(
  userId: string,
  entityType: SharableEntityType,
  entityId: string,
  forbiddenMessage: string,
): Promise<{ ownerId: string }> {
  const loaded = await loadEntityRole(userId, entityType, entityId);
  if (!loaded) throw new AppError(404, NOT_FOUND_MESSAGE[entityType]);
  requireShareOwner(loaded.role, entityType, forbiddenMessage);
  return { ownerId: loaded.ownerId };
}

/**
 * Delete every Share row pointing at an entity, inside the caller's
 * transaction.
 *
 * REQUIRED on every hard-delete of a sharable entity. Share.entityId is
 * polymorphic, so there is no foreign key and Postgres will not cascade:
 * without this call, deleting a waypoint leaves rows that grant access to an
 * id which may later be reused, and leaves the recipient's list rendering a
 * ghost. Callers pass the same transaction that performs the delete — never
 * after it, for the reason writeTombstones states.
 */
export async function deleteSharesFor(
  tx: Prisma.TransactionClient,
  entityType: SharableEntityType,
  entityIds: string[],
): Promise<void> {
  if (entityIds.length === 0) return;
  await tx.share.deleteMany({
    where: { entityType, entityId: { in: entityIds } },
  });
}

/**
 * Revoke every non-canyon share between two users, in BOTH directions, inside
 * the caller's transaction. The unfriend leg of the share lifecycle (APIR-007):
 * shares can only be CREATED between friends, so removing the friendship must
 * take them all back — canyon shares are revoked by the caller, this is the
 * rest.
 *
 * Two different promises, so two different rules:
 *   - `Share` (waypoint / route / topo job / GeoPDF job) is a LIVE view of a
 *     record the owner still holds, so all of it goes.
 *   - `FileSend` handed the recipient a COPY. Only rows they have not taken yet
 *     (`status = "pending"`) are still live access and are revoked; an accepted
 *     send is already theirs and expires on its own within FILE_SEND_TTL_DAYS.
 *     A FileSend left with no recipients is collected by the normal reaper
 *     sweep — deliberately no second delete path here.
 *
 * Tombstones are unconditional for the two synced entity types, with no
 * `hasCanyonInheritedAccess` check (unlike the single revoke in routes/
 * shares.ts): the caller deletes every canyon share between the pair in the
 * same transaction, and only an entity's owner can share their own canyon, so
 * no surviving path exists. A row duplicated with the caller's
 * visibility-loss fan-out is harmless — a tombstone is an idempotent
 * "forget this id".
 */
export async function revokeAllSharesBetween(
  tx: Prisma.TransactionClient,
  userId: string,
  otherId: string,
): Promise<void> {
  const bothDirections = [
    { sharedById: userId, sharedWithId: otherId },
    { sharedById: otherId, sharedWithId: userId },
  ];
  const shares = await tx.share.findMany({
    where: { OR: bothDirections },
    select: { id: true, entityType: true, entityId: true, sharedWithId: true },
  });
  if (shares.length > 0) {
    await tx.share.deleteMany({ where: { id: { in: shares.map((s) => s.id) } } });
    await writeTombstones(
      tx,
      shares.flatMap((share) =>
        share.entityType === "waypoint" || share.entityType === "route"
          ? directShareRevokeTombstones({
              entityType: share.entityType,
              entityId: share.entityId,
              userIds: [share.sharedWithId],
            })
          : [],
      ),
    );
    // Drop each recipient's residual item_shared row, as the single revoke
    // does — the read-time filter already hides it, but a revoked share should
    // not leave a notification at rest (PRIV-001).
    for (const share of shares) {
      await tx.notification.deleteMany({
        where: {
          userId: share.sharedWithId,
          type: "item_shared",
          payload: { path: ["entityId"], equals: share.entityId },
        },
      });
    }
  }

  const pendingSends = await tx.fileSendRecipient.findMany({
    where: {
      status: "pending",
      OR: [
        { userId: otherId, fileSend: { senderId: userId } },
        { userId, fileSend: { senderId: otherId } },
      ],
    },
    select: { id: true, userId: true, fileSendId: true },
  });
  if (pendingSends.length === 0) return;
  await tx.fileSendRecipient.deleteMany({
    where: { id: { in: pendingSends.map((row) => row.id) } },
  });
  for (const row of pendingSends) {
    await tx.notification.deleteMany({
      where: {
        userId: row.userId,
        type: "file_sent",
        payload: { path: ["fileSendId"], equals: row.fileSendId },
      },
    });
  }
}

/**
 * Every entity id of one type shared DIRECTLY with this user.
 *
 * The list/delta queries need the direct-share arm as a set of ids because
 * Share.entityId is polymorphic — there is no foreign key, so Prisma cannot
 * express it as a relation filter the way `canyon: { shares: { some } }` does.
 * One helper rather than the same findMany inlined at five call sites, so the
 * membership rule stays in the file that owns the access decision.
 *
 * ponytail: unbounded IN-list. Fine at personal-account scale (a user's
 * received shares are tens, not thousands); if that stops holding, the upgrade
 * path is a join table with a real FK per entity type, not a bigger IN.
 */
export async function directlySharedIds(
  userId: string,
  entityType: SharableEntityType,
): Promise<string[]> {
  const rows = await prisma.share.findMany({
    where: { sharedWithId: userId, entityType },
    select: { entityId: true },
  });
  return rows.map((row) => row.entityId);
}

/**
 * Everyone a direct share of this entity currently reaches. Feeds the
 * tombstone fan-out on delete, so the recipients forget the row rather than
 * keeping it in their mirror forever.
 */
export async function directShareeIds(
  tx: Prisma.TransactionClient,
  entityType: SharableEntityType,
  entityId: string,
): Promise<string[]> {
  const rows = await tx.share.findMany({
    where: { entityType, entityId },
    select: { sharedWithId: true },
  });
  return rows.map((row) => row.sharedWithId);
}

/** Narrow an untrusted `entityType` from a request path/body, or 400. */
export function parseSharableEntityType(value: unknown): SharableEntityType {
  if (!isSharableEntityType(value)) {
    throw new AppError(400, "Unknown share entity type");
  }
  return value;
}

/**
 * How many people each of these entities is directly shared with, as a map
 * keyed by entity id. Ids absent from the map have no recipients.
 *
 * ONE grouped query for a whole page of rows, not one per row: the delta and
 * the Saved list both need this for every row they render, and a per-row
 * `GET /shares/...` would make listing N items cost N requests.
 *
 * CALLERS MUST PASS OWNED IDS ONLY. A share fan-out is owner-private derived
 * cardinality (root CLAUDE.md): telling a recipient how many OTHER people can
 * see the thing they were given leaks the owner's sharing behaviour, and a
 * test that only asserts the recipient list is withheld would pass while this
 * count leaked. The filter belongs at the call site, where ownership is
 * already known, so this function cannot be handed a mixed page by accident —
 * hence the name says nothing about roles and this comment says it loudly.
 */
export async function shareCountsFor(
  entityType: SharableEntityType,
  ownedEntityIds: string[],
): Promise<Map<string, number>> {
  if (ownedEntityIds.length === 0) return new Map();
  const rows = await prisma.share.groupBy({
    by: ["entityId"],
    where: { entityType, entityId: { in: ownedEntityIds } },
    _count: { entityId: true },
  });
  return new Map(rows.map((row) => [row.entityId, row._count.entityId]));
}

/**
 * Which of these entity ids the user OWNS, for one entity type — the batch form
 * of the owner arm of `getWaypointRole` / `getRouteRole` / `getJobRole`, for the
 * bulk-share endpoint.
 *
 * Here rather than in the caller for the reason the whole file exists: which
 * column holds the owner (`Waypoint.ownerId` vs `TopoJob.userId`) is answered
 * once, and a bulk path that re-derived it would be the second source SEC-001
 * was about.
 *
 * Only the OWNER arm is batched. A sharee may not re-share, so bulk never needs
 * the "shared" role, and a missing id is indistinguishable in the result from a
 * foreign one — the aggregate form of 404-not-403.
 */
export async function filterOwnedEntityIds(
  userId: string,
  entityType: SharableEntityType,
  entityIds: string[],
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();
  const where = { id: { in: entityIds } };
  const select = { id: true };
  const rows =
    entityType === "waypoint"
      ? await prisma.waypoint.findMany({
          where: { ...where, ownerId: userId },
          select,
        })
      : entityType === "route"
        ? await prisma.route.findMany({
            where: { ...where, ownerId: userId },
            select,
          })
        : entityType === "topoJob"
          ? await prisma.topoJob.findMany({
              where: { ...where, userId },
              select,
            })
          : await prisma.geoPdfJob.findMany({
              where: { ...where, userId },
              select,
            });
  return new Set(rows.map((row) => row.id));
}
