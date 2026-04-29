import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";

const router = Router();

// ── GET /analytics ─────────────────────────────────────────────
// Returns aggregate statistics for the current user's canyoning activity.
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const [tripLogsWithCanyon, uniqueCanyonRows, totalCanyons, canyonsWithTrips] =
      await Promise.all([
        prisma.tripLog.findMany({
          where: { userId: user.id },
          select: {
            date: true,
            canyon: { select: { numAbseils: true } },
          },
        }),
        prisma.tripLog.findMany({
          where: { userId: user.id },
          distinct: ["canyonId"],
          select: { canyonId: true },
        }),
        prisma.canyon.count({ where: { ownerId: user.id } }),
        prisma.canyon.count({
          where: { ownerId: user.id, tripLogs: { some: {} } },
        }),
      ]);

    // Aggregate trip dates into { "YYYY-MM-DD": count }
    const tripDates: Record<string, number> = {};
    let totalAbseils: number | null = null;
    const distinctDays = new Set<string>();

    for (const t of tripLogsWithCanyon) {
      const dateStr = t.date.toISOString().split("T")[0];
      tripDates[dateStr] = (tripDates[dateStr] ?? 0) + 1;
      distinctDays.add(dateStr);

      if (t.canyon?.numAbseils != null) {
        totalAbseils = (totalAbseils ?? 0) + t.canyon.numAbseils;
      }
    }

    res.json({
      heroStats: {
        totalTrips: tripLogsWithCanyon.length,
        uniqueCanyons: uniqueCanyonRows.length,
        daysCanyoning: distinctDays.size,
        totalAbseils,
      },
      completion: {
        totalCanyons,
        canyonsWithTrips,
      },
      tripDates,
    });
  },
);

export default router;
