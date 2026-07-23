// Field waypoints (Stage 8 server model for the Stage 7 mobile capture).
// Owner-private: NEVER visible through canyon shares — no share-role logic
// belongs here. 404-not-403 on non-owned ids (owner-private resource, same as
// trip logs — SEC-001 anti-oracle).
import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import { validateWaypointPayload } from "@logjam/shared";
import { waypointDeleteTombstones, writeTombstones } from "../lib/syncTombstones";
import {
  assertClientIdReplayable,
  parseClientSuppliedId,
} from "../lib/clientSuppliedId";
import { Prisma } from "@prisma/client";

const router = Router();

// Hard cap on the list; true total rides X-Total-Count (UX-001 — matches
// /canyons and /trips).
const LIST_TAKE = 500;

// Resolves an optional canyonId association: must be a canyon OWNED by the
// caller. The owner-scoped lookup makes a foreign id indistinguishable from a
// nonexistent one (no existence oracle), mirroring resolveTripCanyonIds.
// undefined → undefined (PATCH: leave unchanged); null → null (clears).
async function resolveCanyonAssociation(
  userId: string,
  canyonId: unknown,
): Promise<string | null | undefined> {
  if (canyonId === undefined) return undefined;
  if (canyonId === null) return null;
  if (typeof canyonId !== "string")
    throw new AppError(400, "canyonId must be a string or null");
  const owned = await prisma.canyon.count({
    where: { id: canyonId, ownerId: userId },
  });
  if (owned !== 1) throw new AppError(400, "Canyon not found");
  return canyonId;
}

// ── GET /waypoints ────────────────────────────────────────────
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const where = { ownerId: user.id };
    const [rows, total] = await Promise.all([
      prisma.waypoint.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: LIST_TAKE,
      }),
      prisma.waypoint.count({ where }),
    ]);
    res.set("X-Total-Count", String(total));
    res.json(rows);
  },
);

// ── POST /waypoints ───────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const { name, latitude, longitude, elevation, symbol, notes, canyonId } =
      req.body ?? {};

    const validationError = validateWaypointPayload(req.body ?? {}, {
      requireCore: true,
    });
    if (validationError) throw new AppError(400, validationError);
    const resolvedCanyonId = await resolveCanyonAssociation(user.id, canyonId);

    // Optional client-minted id (Stage 8 §3.5): own-id replay → 200 with the
    // existing row; foreign id → 404 (see lib/clientSuppliedId.ts).
    const clientId = parseClientSuppliedId((req.body ?? {}).id);
    if (clientId) {
      const existing = await prisma.waypoint.findUnique({
        where: { id: clientId },
      });
      if (existing) {
        assertClientIdReplayable(existing.ownerId, user.id, "Waypoint not found");
        res.status(200).json(existing);
        return;
      }
    }

    let waypoint;
    try {
      waypoint = await prisma.waypoint.create({
        data: {
          ...(clientId && { id: clientId }),
          ownerId: user.id,
          canyonId: resolvedCanyonId ?? null,
          name: (name as string).trim(),
          latitude,
          longitude,
          elevation: elevation ?? null,
          symbol: symbol ?? null,
          notes: notes ?? null,
        },
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
        });
        if (winner && winner.ownerId === user.id) {
          res.status(200).json(winner);
          return;
        }
      }
      throw err;
    }
    res.status(201).json(waypoint);
  },
);

// ── PATCH /waypoints/:id ──────────────────────────────────────
// Field-sparse update; elevation/symbol/notes/canyonId accept explicit null
// to clear.
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const id = getParam(req.params.id);

    const waypoint = await prisma.waypoint.findUnique({ where: { id } });
    // Owner-private resource — 404 (not 403) for non-owners (SEC-001).
    if (!waypoint || waypoint.ownerId !== user.id)
      throw new AppError(404, "Waypoint not found");

    const { name, latitude, longitude, elevation, symbol, notes, canyonId } =
      req.body ?? {};
    const validationError = validateWaypointPayload(req.body ?? {}, {
      requireCore: false,
    });
    if (validationError) throw new AppError(400, validationError);
    const resolvedCanyonId = await resolveCanyonAssociation(user.id, canyonId);

    const updated = await prisma.waypoint.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: (name as string).trim() }),
        ...(latitude !== undefined && { latitude }),
        ...(longitude !== undefined && { longitude }),
        ...(elevation !== undefined && { elevation }),
        ...(symbol !== undefined && { symbol }),
        ...(notes !== undefined && { notes }),
        ...(resolvedCanyonId !== undefined && { canyonId: resolvedCanyonId }),
      },
    });
    res.json(updated);
  },
);

// ── DELETE /waypoints/:id ─────────────────────────────────────
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const id = getParam(req.params.id);

    const waypoint = await prisma.waypoint.findUnique({ where: { id } });
    // Owner-private resource — 404 (not 403) for non-owners (SEC-001).
    if (!waypoint || waypoint.ownerId !== user.id)
      throw new AppError(404, "Waypoint not found");

    await prisma.$transaction(async (tx) => {
      await tx.waypoint.delete({ where: { id } });
      // Same transaction as the delete (sync tombstone rule).
      await writeTombstones(
        tx,
        waypointDeleteTombstones({ ownerId: user.id, waypointId: id }),
      );
    });

    res.status(204).send();
  },
);

export default router;
