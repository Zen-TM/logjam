import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";

const router = Router();

async function fetchCanyons(where: object) {
  return prisma.canyon.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { tripLogs: true } },
    },
  });
}

function getParam(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}

// GET /canyons — owned canyons
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");
    res.json(await fetchCanyons({ ownerId: user.id }));
  },
);

// GET /canyons/shared — canyons shared with me
router.get(
  "/shared",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");
    res.json(
      await fetchCanyons({ shares: { some: { sharedWithId: user.id } } }),
    );
  },
);

// ── POST /canyons ─────────────────────────────────────────────
// Creates a new canyon
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const {
      name,
      altNames,
      latitude,
      longitude,
      numAbseils,
      longestAbseil,
      vGrade,
      aGrade,
      commitment,
      quality,
      wetsuits,
      hours,

      notes,
      attributes,
    } = req.body;

    if (!name || latitude === undefined || longitude === undefined) {
      throw new AppError(400, "name, latitude, and longitude are required");
    }

    const canyon = await prisma.canyon.create({
      data: {
        ownerId: user.id,
        name,
        altNames: altNames ?? [],
        latitude,
        longitude,
        numAbseils,
        longestAbseil,
        vGrade,
        aGrade,
        commitment,
        quality,
        wetsuits,
        hours,
  
        notes,
        attributes: attributes ?? {},
      },
    });

    res.status(201).json(canyon);
  },
);

// ── POST /canyons/:id/copy ─────────────────────────────────────────────
// Copies a shared canyon
router.post(
  "/:id/copy",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyonId = getParam(req.params.id);
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");

    // Check if the user has access to the canyon
    const isOwner = canyon.ownerId === user.id;
    const isShared = await prisma.canyonShare.findFirst({
      where: { canyonId, sharedWithId: user.id },
    });
    if (!isOwner && !isShared) throw new AppError(403, "Access denied");

    // Create a copy of the canyon
    const copiedCanyon = await prisma.canyon.create({
      data: {
        ownerId: user.id,
        name: canyon.name,
        altNames: canyon.altNames,
        latitude: canyon.latitude,
        longitude: canyon.longitude,
        numAbseils: canyon.numAbseils,
        longestAbseil: canyon.longestAbseil,
        vGrade: canyon.vGrade,
        aGrade: canyon.aGrade,
        commitment: canyon.commitment,
        quality: canyon.quality,
        wetsuits: canyon.wetsuits,
        hours: canyon.hours,
        notes: canyon.notes,
        attributes: canyon.attributes ?? Prisma.JsonNull,
        forkedFromId: canyonId,
      },
    });

    res.status(201).json(copiedCanyon);
  },
);

// ── GET /canyons/:id ──────────────────────────────────────────
// Returns a single canyon. Owners receive trip logs + all media.
// Share recipients receive canyon record + canyon-level media only
// (trip logs and trip media are owner-private — hybrid sharing model).
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyonId = getParam(req.params.id);

    // Fetch owner first so we can decide includes before the full query.
    const stub = await prisma.canyon.findUnique({
      where: { id: canyonId },
      select: { ownerId: true },
    });
    if (!stub) throw new AppError(404, "Canyon not found");

    const isOwner = stub.ownerId === user.id;
    if (!isOwner) {
      const share = await prisma.canyonShare.findFirst({
        where: { canyonId, sharedWithId: user.id },
      });
      if (!share) throw new AppError(403, "Access denied");
    }

    const canyon = await prisma.canyon.findUnique({
      where: { id: canyonId },
      include: isOwner
        ? { tripLogs: { orderBy: { date: "desc" }, include: { media: true } }, media: true }
        : { media: true },
    });

    res.json(canyon);
  },
);

// ── PATCH /canyons/:id ────────────────────────────────────────
// Updates an existing canyon (owner only)
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyon = await prisma.canyon.findUnique({
      where: { id: getParam(req.params.id) },
    });

    if (!canyon) throw new AppError(404, "Canyon not found");
    if (canyon.ownerId !== user.id)
      throw new AppError(403, "Only the owner can edit a canyon");

    const {
      name,
      altNames,
      latitude,
      longitude,
      numAbseils,
      longestAbseil,
      vGrade,
      aGrade,
      commitment,
      quality,
      wetsuits,
      hours,

      notes,
      attributes,
    } = req.body;

    const updated = await prisma.canyon.update({
      where: { id: getParam(req.params.id) },
      data: {
        ...(name !== undefined && { name }),
        ...(altNames !== undefined && { altNames }),
        ...(latitude !== undefined && { latitude }),
        ...(longitude !== undefined && { longitude }),
        ...(numAbseils !== undefined && { numAbseils }),
        ...(longestAbseil !== undefined && { longestAbseil }),
        ...(vGrade !== undefined && { vGrade }),
        ...(aGrade !== undefined && { aGrade }),
        ...(commitment !== undefined && { commitment }),
        ...(quality !== undefined && { quality }),
        ...(wetsuits !== undefined && { wetsuits }),
        ...(hours !== undefined && { hours }),
        ...(notes !== undefined && { notes }),
        ...(attributes !== undefined && {
          attributes: attributes ?? Prisma.JsonNull,
        }),
      },
    });

    res.json(updated);
  },
);

// ── DELETE /canyons/:id ───────────────────────────────────────
// Deletes a canyon and all associated data (owner only)
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyon = await prisma.canyon.findUnique({
      where: { id: getParam(req.params.id) },
    });

    if (!canyon) throw new AppError(404, "Canyon not found");
    if (canyon.ownerId !== user.id)
      throw new AppError(403, "Only the owner can delete a canyon");

    const id = getParam(req.params.id);

    const tripIds = (
      await prisma.tripLog.findMany({
        where: { canyonId: id },
        select: { id: true },
      })
    ).map((t) => t.id);

    await prisma.$transaction([
      prisma.media.deleteMany({
        where: { linkedType: "tripLog", linkedId: { in: tripIds } },
      }),
      prisma.media.deleteMany({
        where: { linkedType: "canyon", linkedId: id },
      }),
      prisma.tripLog.deleteMany({ where: { canyonId: id } }),
      prisma.canyonShare.deleteMany({ where: { canyonId: id } }),
      prisma.canyon.delete({ where: { id } }),
    ]);

    res.status(204).send();
  },
);

export default router;
