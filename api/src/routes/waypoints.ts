// Field waypoints (Stage 8 server model for the Stage 7 mobile capture).
//
// Visibility follows canyon-level MEDIA, exactly as a linked Route does: an
// UNLINKED waypoint is owner-private, and one linked to a shared canyon is part
// of that shared record — sharees may read and export it, never edit it. The
// decision is derived from lib/canyonAccess.ts, never re-implemented inline
// (SEC-001), and every LINK change goes through lib/waypointLink.ts, which owns
// the many-to-many revocation rule.
//
// Denial statuses follow the house anti-oracle rule: a caller with no path to
// the waypoint gets 404 (never confirming the id exists), while a SHAREE
// attempting an owner-only mutation gets 403 (they legitimately see the row and
// merely lack the permission).
import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import {
  normalizeWaypointCanyonIds,
  normalizeWaypointTags,
  validateWaypointPayload,
} from "@logjam/shared";
import { waypointDeleteTombstones, writeTombstones } from "../lib/syncTombstones";
import {
  applyWaypointCanyonLinks,
  resolveWaypointCanyonIds,
  serializeWaypointFor,
  snapshotWaypointVisibility,
  waypointInclude,
  type WaypointWithLinks,
} from "../lib/waypointLink";
import {
  assertClientIdReplayable,
  parseClientSuppliedId,
} from "../lib/clientSuppliedId";
import { Prisma } from "@prisma/client";

const router = Router();

// Hard cap on the list; true total rides X-Total-Count (UX-001 — matches
// /canyons and /trips).
const LIST_TAKE = 500;

/** Canyon ids shared WITH `userId` — the set that grants sight of a waypoint. */
async function sharedCanyonIdSet(userId: string): Promise<Set<string>> {
  const shares = await prisma.canyonShare.findMany({
    where: { sharedWithId: userId },
    select: { canyonId: true },
  });
  return new Set(shares.map((share) => share.canyonId));
}

/**
 * Load a waypoint the caller is entitled to SEE, or 404. Returns the row plus
 * the role, so mutation handlers can tell a sharee (403) from a stranger (404)
 * without re-deriving the access decision.
 */
async function loadVisibleWaypoint(
  userId: string,
  id: string,
): Promise<{
  waypoint: WaypointWithLinks;
  role: "owner" | "shared";
  sharedCanyonIds: Set<string>;
}> {
  const waypoint = await prisma.waypoint.findUnique({
    where: { id },
    include: waypointInclude,
  });
  if (!waypoint) throw new AppError(404, "Waypoint not found");
  if (waypoint.ownerId === userId) {
    return { waypoint, role: "owner", sharedCanyonIds: new Set() };
  }
  const sharedCanyonIds = await sharedCanyonIdSet(userId);
  const visible = waypoint.canyonLinks.some((link) =>
    sharedCanyonIds.has(link.canyonId),
  );
  // No path at all → 404, so the status never confirms the id exists.
  if (!visible) throw new AppError(404, "Waypoint not found");
  return { waypoint, role: "shared", sharedCanyonIds };
}

/** Owner-only mutation guard: 404 for a stranger, 403 for a sharee. */
async function requireWaypointOwner(
  userId: string,
  id: string,
): Promise<WaypointWithLinks> {
  const { waypoint, role } = await loadVisibleWaypoint(userId, id);
  if (role !== "owner") {
    throw new AppError(403, "Only the owner can change this waypoint");
  }
  return waypoint;
}

/** Shape-check then authorize a canyonIds list, or throw the first error. */
async function parseCanyonIds(
  userId: string,
  value: unknown,
): Promise<string[] | undefined> {
  const parsed = normalizeWaypointCanyonIds(value);
  if ("error" in parsed) throw new AppError(400, parsed.error);
  if (parsed.canyonIds === undefined) return undefined;
  return resolveWaypointCanyonIds(userId, parsed.canyonIds);
}

/** Shape-check a tag list, or throw. */
function parseTags(value: unknown): string[] | undefined {
  const parsed = normalizeWaypointTags(value);
  if ("error" in parsed) throw new AppError(400, parsed.error);
  return parsed.tags;
}

// ── GET /waypoints ────────────────────────────────────────────
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const sharedCanyonIds = await sharedCanyonIdSet(user.id);
    // Own waypoints, plus those linked to a canyon shared WITH me — the same
    // visibility canyon-level media has. An unlinked waypoint of another owner
    // can never match.
    const where: Prisma.WaypointWhereInput = {
      OR: [
        { ownerId: user.id },
        {
          canyonLinks: {
            some: { canyonId: { in: [...sharedCanyonIds] } },
          },
        },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.waypoint.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: LIST_TAKE,
        include: waypointInclude,
      }),
      prisma.waypoint.count({ where }),
    ]);
    res.set("X-Total-Count", String(total));
    res.json(
      rows.map((row) => serializeWaypointFor(row, user.id, sharedCanyonIds)),
    );
  },
);

// ── GET /waypoints/:id ────────────────────────────────────────
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const { waypoint, sharedCanyonIds } = await loadVisibleWaypoint(
      user.id,
      getParam(req.params.id),
    );
    res.json(serializeWaypointFor(waypoint, user.id, sharedCanyonIds));
  },
);

// ── POST /waypoints ───────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const { name, latitude, longitude, elevation, symbol, notes } =
      req.body ?? {};

    const validationError = validateWaypointPayload(req.body ?? {}, {
      requireCore: true,
    });
    if (validationError) throw new AppError(400, validationError);
    const tags = parseTags((req.body ?? {}).tags);
    const canyonIds =
      (await parseCanyonIds(user.id, (req.body ?? {}).canyonIds)) ?? [];

    // Optional client-minted id (Stage 8 §3.5): own-id replay → 200 with the
    // existing row; foreign id → 404 (see lib/clientSuppliedId.ts).
    const clientId = parseClientSuppliedId((req.body ?? {}).id);
    if (clientId) {
      const existing = await prisma.waypoint.findUnique({
        where: { id: clientId },
        include: waypointInclude,
      });
      if (existing) {
        assertClientIdReplayable(existing.ownerId, user.id, "Waypoint not found");
        res.status(200).json(serializeWaypointFor(existing, user.id, new Set()));
        return;
      }
    }

    let waypoint;
    try {
      waypoint = await prisma.waypoint.create({
        data: {
          ...(clientId && { id: clientId }),
          ownerId: user.id,
          name: (name as string).trim(),
          latitude,
          longitude,
          elevation: elevation ?? null,
          symbol: symbol ?? null,
          notes: notes ?? null,
          tags: tags ?? [],
          // A brand-new waypoint has no prior visibility, so linking it can
          // only ADD viewers — no tombstone diff is possible here, which is why
          // this is a nested create rather than applyWaypointCanyonLinks.
          canyonLinks: { create: canyonIds.map((canyonId) => ({ canyonId })) },
        },
        include: waypointInclude,
      });
    } catch (err) {
      // Concurrent replay of the same client id — return the winner's row,
      // mirroring media-confirm.
      if (
        clientId &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const winner = await prisma.waypoint.findUnique({
          where: { id: clientId },
          include: waypointInclude,
        });
        if (winner && winner.ownerId === user.id) {
          res.status(200).json(serializeWaypointFor(winner, user.id, new Set()));
          return;
        }
      }
      throw err;
    }
    res.status(201).json(serializeWaypointFor(waypoint, user.id, new Set()));
  },
);

// ── PATCH /waypoints/:id ──────────────────────────────────────
// Field-sparse update; elevation/symbol/notes accept explicit null to clear,
// and canyonIds/tags accept null to empty the list. Owner only — a sharee sees
// the waypoint but may never edit it (403, not 404: they can see it already).
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const id = getParam(req.params.id);
    await requireWaypointOwner(user.id, id);

    const { name, latitude, longitude, elevation, symbol, notes } =
      req.body ?? {};
    const validationError = validateWaypointPayload(req.body ?? {}, {
      requireCore: false,
    });
    if (validationError) throw new AppError(400, validationError);
    const tags = parseTags((req.body ?? {}).tags);
    const canyonIds = await parseCanyonIds(user.id, (req.body ?? {}).canyonIds);

    const updated = await prisma.$transaction(async (tx) => {
      // Links first: applyWaypointCanyonLinks writes the revocation tombstones
      // for whoever this change costs, and must ride the same transaction as
      // the change it records (sync tombstone rule).
      if (canyonIds !== undefined) {
        await applyWaypointCanyonLinks(tx, { waypointId: id, canyonIds });
      }
      return tx.waypoint.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: (name as string).trim() }),
          ...(latitude !== undefined && { latitude }),
          ...(longitude !== undefined && { longitude }),
          ...(elevation !== undefined && { elevation }),
          ...(symbol !== undefined && { symbol }),
          ...(notes !== undefined && { notes }),
          ...(tags !== undefined && { tags }),
        },
        include: waypointInclude,
      });
    });
    res.json(serializeWaypointFor(updated, user.id, new Set()));
  },
);

// ── DELETE /waypoints/:id ─────────────────────────────────────
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const id = getParam(req.params.id);

    await requireWaypointOwner(user.id, id);

    await prisma.$transaction(async (tx) => {
      // Who could see it, captured before the row (and its links) go.
      const viewers = await snapshotWaypointVisibility(tx, [id]);
      await tx.waypoint.delete({ where: { id } });
      // Same transaction as the delete (sync tombstone rule). A delete revokes
      // EVERY viewer unconditionally, so this needs no diff — unlike an unlink.
      await writeTombstones(
        tx,
        waypointDeleteTombstones({
          ownerId: user.id,
          waypointId: id,
          shareeIds: [...(viewers.get(id) ?? [])],
        }),
      );
    });

    res.status(204).send();
  },
);

export default router;
