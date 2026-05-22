import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";
import { getEnv } from "../lib/env";
import { deleteS3Keys } from "../lib/s3Cleanup";
import { decrementStorageUsed } from "../lib/storageQuota";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

const BULK_DELETE_LIMIT = 500;

const router = Router();

type BulkTripInput = {
  canyonId: string;
  date: string;
  notes?: string | null;
  customFields?: Record<string, unknown>;
};

// POST /trips/bulk
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const { trips } = req.body as { trips: BulkTripInput[] };
    if (!Array.isArray(trips) || trips.length === 0) {
      throw new AppError(400, "trips array is required");
    }

    const errors: { index: number; error: string }[] = [];
    const validData: Prisma.TripLogCreateManyInput[] = [];

    const canyonIds = Array.from(
      new Set(trips.map((t) => t.canyonId).filter((id): id is string => Boolean(id))),
    );
    const owned = await prisma.canyon.findMany({
      where: { id: { in: canyonIds } },
      select: { id: true, ownerId: true },
    });
    const ownerById = new Map(owned.map((c) => [c.id, c.ownerId]));

    for (let i = 0; i < trips.length; i++) {
      const t = trips[i];
      if (!t.canyonId || !t.date) {
        errors.push({ index: i, error: "canyonId and date are required" });
        continue;
      }
      const date = new Date(t.date);
      if (isNaN(date.getTime())) {
        errors.push({ index: i, error: `invalid date: ${t.date}` });
        continue;
      }
      const ownerId = ownerById.get(t.canyonId);
      if (ownerId === undefined) {
        errors.push({ index: i, error: "canyon not found" });
        continue;
      }
      if (ownerId !== user.id) {
        errors.push({ index: i, error: "not the canyon owner" });
        continue;
      }
      validData.push({
        canyonId: t.canyonId,
        userId: user.id,
        date,
        notes: t.notes ?? null,
        customFields: (t.customFields ?? {}) as Prisma.InputJsonValue,
      });
    }

    if (validData.length > 0) {
      await prisma.tripLog.createMany({ data: validData });
    }

    res.json({ imported: validData.length, errors });
  },
);

// POST /trips/bulk/delete — bulk delete trip logs by ID (canyon owner only)
router.post(
  "/delete",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const { ids } = req.body as { ids: unknown };
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, "ids array is required");
    }
    if (ids.length > BULK_DELETE_LIMIT) {
      throw new AppError(400, `Cannot delete more than ${BULK_DELETE_LIMIT} trip logs at once`);
    }

    const trips = await prisma.tripLog.findMany({
      where: { id: { in: ids as string[] } },
      include: { canyon: { select: { ownerId: true } } },
    });

    const ownedIds = trips
      .filter((t) => t.canyon.ownerId === user.id)
      .map((t) => t.id);

    if (ownedIds.length === 0) {
      res.json({ deletedIds: [] });
      return;
    }

    const media = await prisma.media.findMany({
      where: { linkedType: "tripLog", linkedId: { in: ownedIds } },
      select: { s3KeyDisplay: true, s3KeyThumbnail: true, fileSizeBytes: true },
    });

    await prisma.$transaction([
      prisma.media.deleteMany({ where: { linkedType: "tripLog", linkedId: { in: ownedIds } } }),
      prisma.tripLog.deleteMany({ where: { id: { in: ownedIds } } }),
    ]);

    const s3Keys = media.flatMap((m) =>
      [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
    );
    const totalBytes = media.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0n), 0n);
    await deleteS3Keys(MEDIA_BUCKET, s3Keys);
    await decrementStorageUsed(user.id, totalBytes);

    res.json({ deletedIds: ownedIds });
  },
);

export default router;
