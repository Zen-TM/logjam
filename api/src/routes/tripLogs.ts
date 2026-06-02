import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";
import { getParam } from "../lib/getParam";
import { getEnv } from "../lib/env";
import { deleteS3Keys } from "../lib/s3Cleanup";
import { decrementStorageUsed } from "../lib/storageQuota";
import { toMediaItems, mediaItemsByLinkedId } from "../lib/mediaPresign";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

const router = Router({ mergeParams: true });

// ── GET /canyons/:canyonId/trips ──────────────────────────────
// Returns all trip logs for a canyon
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyonId = getParam(req.params.canyonId);
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");

    // Check access — owner or shared
    const isOwner = canyon.ownerId === user.id;
    if (!isOwner) {
      const isShared = await prisma.canyonShare.findFirst({
        where: { canyonId, sharedWithId: user.id },
      });
      if (!isShared) throw new AppError(403, "Access denied");
      // Trip logs are owner-private (hybrid sharing model).
      res.json([]);
      return;
    }

    const trips = await prisma.tripLog.findMany({
      where: { canyonId },
      orderBy: { date: "desc" },
    });

    const tripIds = trips.map((trip) => trip.id);
    const mediaRows = tripIds.length
      ? await prisma.media.findMany({
          where: { linkedType: "tripLog", linkedId: { in: tripIds } },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const mediaByTrip = await mediaItemsByLinkedId(mediaRows);

    res.json(
      trips.map((trip) => ({ ...trip, media: mediaByTrip.get(trip.id) ?? [] })),
    );
  },
);

// ── GET /canyons/:canyonId/trips/:id ──────────────────────────
// Returns a single trip log
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const id = getParam(req.params.id);
    const trip = await prisma.tripLog.findUnique({
      where: { id },
      include: { canyon: { select: { id: true, name: true, ownerId: true } } },
    });
    if (!trip) throw new AppError(404, "Trip log not found");

    // Check access via the parent canyon
    const isOwner = trip.canyon.ownerId === user.id;
    const isShared = await prisma.canyonShare.findFirst({
      where: { canyonId: trip.canyonId, sharedWithId: user.id },
    });
    if (!isOwner && !isShared) throw new AppError(403, "Access denied");

    const mediaRows = await prisma.media.findMany({
      where: { linkedType: "tripLog", linkedId: id },
      orderBy: { createdAt: "asc" },
    });
    res.json({ ...trip, media: await toMediaItems(mediaRows) });
  },
);

// ── POST /canyons/:canyonId/trips ─────────────────────────────
// Creates a new trip log for a canyon
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyonId = getParam(req.params.canyonId);
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");

    // Only the canyon owner can add trips
    if (canyon.ownerId !== user.id)
      throw new AppError(403, "Only the canyon owner can add trip logs");

    const { date, notes, customFields } = req.body;
    if (!date) throw new AppError(400, "date is required");

    const trip = await prisma.tripLog.create({
      data: {
        canyonId,
        userId: user.id,
        date: new Date(date),
        notes,
        customFields: customFields ?? {},
      },
    });

    res.status(201).json(trip);
  },
);

// ── PATCH /canyons/:canyonId/trips/:id ────────────────────────
// Updates a trip log
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const id = getParam(req.params.id);
    const trip = await prisma.tripLog.findUnique({
      where: { id },
      include: { canyon: true },
    });
    if (!trip) throw new AppError(404, "Trip log not found");
    if (trip.canyonId !== getParam(req.params.canyonId))
      throw new AppError(404, "Trip log not found");
    if (trip.canyon.ownerId !== user.id)
      throw new AppError(403, "Only the canyon owner can edit trip logs");

    const { date, notes, customFields } = req.body;

    const updated = await prisma.tripLog.update({
      where: { id },
      data: {
        ...(date !== undefined && { date: new Date(date) }),
        ...(notes !== undefined && { notes }),
        ...(customFields !== undefined && {
          customFields: customFields ?? Prisma.JsonNull,
        }),
      },
    });

    res.json(updated);
  },
);

// ── DELETE /canyons/:canyonId/trips/:id ───────────────────────
// Deletes a trip log and its media
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const id = getParam(req.params.id);
    const trip = await prisma.tripLog.findUnique({
      where: { id },
      include: { canyon: true },
    });
    if (!trip) throw new AppError(404, "Trip log not found");
    if (trip.canyonId !== getParam(req.params.canyonId))
      throw new AppError(404, "Trip log not found");
    if (trip.canyon.ownerId !== user.id)
      throw new AppError(403, "Only the canyon owner can delete trip logs");

    const media = await prisma.media.findMany({
      where: { linkedType: "tripLog", linkedId: id },
      select: { s3KeyDisplay: true, s3KeyThumbnail: true, fileSizeBytes: true },
    });

    await prisma.$transaction([
      prisma.media.deleteMany({
        where: { linkedType: "tripLog", linkedId: id },
      }),
      prisma.tripLog.delete({ where: { id } }),
    ]);

    const s3Keys = media.flatMap((m) =>
      [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
    );
    const totalBytes = media.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0n), 0n);
    await deleteS3Keys(MEDIA_BUCKET, s3Keys);
    await decrementStorageUsed(user.id, totalBytes);

    res.status(204).send();
  },
);

export default router;
