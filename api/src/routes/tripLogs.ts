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
import { getCanyonRole, requireCanyonOwner } from "../lib/canyonAccess";
import { resolveUser } from "../lib/resolveUser";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

const router = Router({ mergeParams: true });

// ── GET /canyons/:canyonId/trips ──────────────────────────────
// Returns all trip logs for a canyon
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const canyonId = getParam(req.params.canyonId);
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");

    const role = await getCanyonRole(user.id, canyon);
    if (role === "none") throw new AppError(403, "Access denied");
    if (role === "shared") {
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
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    const trip = await prisma.tripLog.findUnique({
      where: { id },
      include: { canyon: { select: { id: true, name: true, ownerId: true } } },
    });
    if (!trip) throw new AppError(404, "Trip log not found");
    if (trip.canyonId !== getParam(req.params.canyonId))
      throw new AppError(404, "Trip log not found");

    // Per-trip notes and media are owner-private (hybrid sharing model) —
    // share recipients must NOT reach them, and get 404 (not 403) so the
    // response is no existence oracle for trip IDs (SEC-001).
    requireCanyonOwner(
      user.id,
      trip.canyon,
      new AppError(404, "Trip log not found"),
    );

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
    const user = await resolveUser(req.user!.sub);

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
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    const trip = await prisma.tripLog.findUnique({
      where: { id },
      include: { canyon: true },
    });
    if (!trip) throw new AppError(404, "Trip log not found");
    if (trip.canyonId !== getParam(req.params.canyonId))
      throw new AppError(404, "Trip log not found");

    // Owner-private resource — 404 (not 403) for non-owners so the response
    // is no existence oracle for trip IDs (SEC-001).
    requireCanyonOwner(
      user.id,
      trip.canyon,
      new AppError(404, "Trip log not found"),
    );

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
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    const trip = await prisma.tripLog.findUnique({
      where: { id },
      include: { canyon: true },
    });
    if (!trip) throw new AppError(404, "Trip log not found");
    if (trip.canyonId !== getParam(req.params.canyonId))
      throw new AppError(404, "Trip log not found");

    // Owner-private resource — 404 (not 403) for non-owners so the response
    // is no existence oracle for trip IDs (SEC-001).
    requireCanyonOwner(
      user.id,
      trip.canyon,
      new AppError(404, "Trip log not found"),
    );

    const media = await prisma.media.findMany({
      where: { linkedType: "tripLog", linkedId: id },
      select: { s3KeyDisplay: true, s3KeyThumbnail: true, fileSizeBytes: true },
    });

    // S3-first (ARCH-004): blobs go before the rows, so an S3 failure leaves
    // the rows (and therefore the keys) intact for a retried DELETE. The row
    // deletes and the quota decrement then share one transaction so a crash
    // between them can't leave the quota over-counted.
    const s3Keys = media.flatMap((m) =>
      [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
    );
    const totalBytes = media.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0n), 0n);
    await deleteS3Keys(MEDIA_BUCKET, s3Keys);

    await prisma.$transaction(async (tx) => {
      await tx.media.deleteMany({
        where: { linkedType: "tripLog", linkedId: id },
      });
      await tx.tripLog.delete({ where: { id } });
      await decrementStorageUsed(user.id, totalBytes, tx);
    });

    res.status(204).send();
  },
);

export default router;
