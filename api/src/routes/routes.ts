// User-authored routes (drawn, imported, or derived from a recording).
// Geometry is a vertex list on the row, so this is ordinary CRUD — there is no
// S3 leg, no presign/confirm, and no orphan sweeper. See the Route model in
// schema.prisma for why.
//
// Visibility follows canyon-level MEDIA, not waypoints:
//   - unlinked route  → owner-private;
//   - linked route    → also visible to everyone the canyon is shared with,
//                       read-only (view + export, never edit).
// Non-owned ids are 404, never 403, so a status can't confirm a route exists
// to someone who can't see it (SEC-001 anti-oracle). A SHAREE attempting a
// mutation gets 403 — they legitimately see the route, they just can't change
// it — matching requireCanyonOwnerAccess's split.
import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import {
  validateRoutePayload,
  parseRouteColor,
  parseRoutePoints,
  randomTrackColor,
} from "@logjam/shared";
import {
  applyRouteCanyonLink,
  canyonShareeIds,
  parseAnchorsOrNull,
  resolveRouteCanyonId,
} from "../lib/routeLink";
import { routeDeleteTombstones, writeTombstones } from "../lib/syncTombstones";
import {
  assertClientIdReplayable,
  parseClientSuppliedId,
} from "../lib/clientSuppliedId";

const router = Router();

// Hard cap on the list; true total rides X-Total-Count (UX-001 — matches
// /canyons, /trips and /waypoints).
const LIST_TAKE = 500;

const NOT_FOUND = "Route not found";

/** The caller's relationship to a route. Mirrors CanyonRole. */
type RouteRole = "owner" | "shared" | "none";

type RouteRow = { id: string; ownerId: string; canyonId: string | null };

/**
 * Owner, sharee (via the linked canyon), or neither. A route is only ever
 * visible to a non-owner through the canyon it is linked to, so the share
 * check is a canyon-share check — never re-derived from route state.
 */
async function getRouteRole(userId: string, route: RouteRow): Promise<RouteRole> {
  if (route.ownerId === userId) return "owner";
  if (route.canyonId === null) return "none";
  const shared = await prisma.canyonShare.count({
    where: { canyonId: route.canyonId, sharedWithId: userId },
  });
  return shared > 0 ? "shared" : "none";
}

/** Load a route for a mutation, or throw. none → 404, sharee → 403. */
async function requireOwnedRoute(userId: string, id: string) {
  const route = await prisma.route.findUnique({ where: { id } });
  if (!route) throw new AppError(404, NOT_FOUND);
  const role = await getRouteRole(userId, route);
  if (role === "none") throw new AppError(404, NOT_FOUND);
  if (role === "shared") {
    throw new AppError(403, "Only the owner can change this route");
  }
  return route;
}

// ── GET /routes ───────────────────────────────────────────────
// Owned routes, plus routes linked to canyons shared with the caller. Derived
// purely from the caller's own access set (same shape as GET /canyons/tracks),
// so it never accepts an arbitrary id.
router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = await resolveUser(req.user!.sub);
  const where: Prisma.RouteWhereInput = {
    OR: [
      { ownerId: user.id },
      { canyon: { shares: { some: { sharedWithId: user.id } } } },
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.route.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: LIST_TAKE,
    }),
    prisma.route.count({ where }),
  ]);
  res.set("X-Total-Count", String(total));
  res.json(rows);
});

// ── GET /routes/:id ───────────────────────────────────────────
router.get("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = await resolveUser(req.user!.sub);
  const id = getParam(req.params.id);
  const route = await prisma.route.findUnique({ where: { id } });
  if (!route) throw new AppError(404, NOT_FOUND);
  if ((await getRouteRole(user.id, route)) === "none") {
    throw new AppError(404, NOT_FOUND);
  }
  res.json(route);
});

// ── POST /routes ──────────────────────────────────────────────
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = await resolveUser(req.user!.sub);
  const body = req.body ?? {};

  const validationError = validateRoutePayload(body, { requireCore: true });
  if (validationError) throw new AppError(400, validationError);
  // Re-parse for the normalised (rounded, elevation-stripped) points; the
  // validator above has already proved the shape.
  const parsed = parseRoutePoints(body.points);
  if ("error" in parsed) throw new AppError(400, parsed.error);

  const canyonId = (await resolveRouteCanyonId(user.id, body.canyonId)) ?? null;

  // Optional client-minted id (Stage 8 §3.5): own-id replay → 200 with the
  // existing row; foreign id → 404 (see lib/clientSuppliedId.ts).
  const clientId = parseClientSuppliedId(body.id);
  if (clientId) {
    const existing = await prisma.route.findUnique({ where: { id: clientId } });
    if (existing) {
      assertClientIdReplayable(existing.ownerId, user.id, NOT_FOUND);
      res.status(200).json(existing);
      return;
    }
  }

  try {
    // Create unlinked, then route the link through applyRouteCanyonLink so the
    // displacement rule and its tombstones have exactly one implementation.
    const created = await prisma.$transaction(async (tx) => {
      const route = await tx.route.create({
        data: {
          ...(clientId && { id: clientId }),
          ownerId: user.id,
          canyonId: null,
          name: (body.name as string).trim(),
          // The client may choose from the shared palette; when it doesn't,
          // the server picks. Mobile picks at draw time so the line is its
          // final colour from the first frame rather than changing under the
          // user when the create op comes back.
          color: parseRouteColor(body.color) ?? randomTrackColor(),
          points: parsed.points,
          anchors: parseAnchorsOrNull(body.anchors, parsed.points.length),
        },
      });
      if (canyonId === null) return { route, displacedRoute: null };
      const { displacedRoute } = await applyRouteCanyonLink(tx, {
        routeId: route.id,
        canyonId,
        currentCanyonId: null,
      });
      const linked = await tx.route.findUniqueOrThrow({ where: { id: route.id } });
      return { route: linked, displacedRoute };
    });
    res.status(201).json({ ...created.route, displacedRoute: created.displacedRoute });
  } catch (err) {
    // Concurrent replay of the same client id — return the winner's row,
    // mirroring media-confirm and waypoints.
    if (
      clientId &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const winner = await prisma.route.findUnique({ where: { id: clientId } });
      if (winner && winner.ownerId === user.id) {
        res.status(200).json(winner);
        return;
      }
    }
    throw err;
  }
});

// ── PATCH /routes/:id ─────────────────────────────────────────
// Field-sparse update. `canyonId` accepts an explicit null to unlink.
router.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = await resolveUser(req.user!.sub);
  const id = getParam(req.params.id);
  const route = await requireOwnedRoute(user.id, id);

  const body = req.body ?? {};
  const validationError = validateRoutePayload(body, { requireCore: false });
  if (validationError) throw new AppError(400, validationError);

  const color = parseRouteColor(body.color) ?? undefined;
  let points: [number, number][] | undefined;
  let anchors: number[] | typeof Prisma.DbNull | undefined;
  if (body.points !== undefined) {
    const parsed = parseRoutePoints(body.points);
    if ("error" in parsed) throw new AppError(400, parsed.error);
    points = parsed.points;
    // Anchors travel with the geometry they index. A PATCH that moves points
    // without sending anchors clears them, which reads as "no record" — never
    // as stale indices into geometry that has changed underneath them.
    anchors = parseAnchorsOrNull(body.anchors, parsed.points.length);
  }
  const resolvedCanyonId = await resolveRouteCanyonId(user.id, body.canyonId);

  const result = await prisma.$transaction(async (tx) => {
    if (body.name !== undefined || points !== undefined || color !== undefined) {
      await tx.route.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: (body.name as string).trim() }),
          ...(points !== undefined && { points, anchors }),
          ...(color !== undefined && { color }),
        },
      });
    }
    let displacedRoute: { id: string; name: string } | null = null;
    if (resolvedCanyonId !== undefined) {
      ({ displacedRoute } = await applyRouteCanyonLink(tx, {
        routeId: id,
        canyonId: resolvedCanyonId,
        currentCanyonId: route.canyonId,
      }));
    }
    const updated = await tx.route.findUniqueOrThrow({ where: { id } });
    return { updated, displacedRoute };
  });

  res.json({ ...result.updated, displacedRoute: result.displacedRoute });
});

// ── DELETE /routes/:id ────────────────────────────────────────
router.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = await resolveUser(req.user!.sub);
  const id = getParam(req.params.id);
  const route = await requireOwnedRoute(user.id, id);

  await prisma.$transaction(async (tx) => {
    // Sharees of the linked canyon must forget it too (a linked route is part
    // of the shared canyon record). Read the fan-out BEFORE the delete.
    const shareeIds =
      route.canyonId === null ? [] : await canyonShareeIds(tx, route.canyonId);
    await tx.route.delete({ where: { id } });
    // Same transaction as the delete (sync tombstone rule).
    await writeTombstones(
      tx,
      routeDeleteTombstones({ ownerId: user.id, routeId: id, shareeIds }),
    );
  });

  res.status(204).send();
});

export default router;
