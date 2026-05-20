import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";

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

export default router;
