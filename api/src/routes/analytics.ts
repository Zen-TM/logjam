import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { resolveUser } from "../lib/resolveUser";

const router = Router();

// ── GET /analytics ─────────────────────────────────────────────
// Returns aggregate statistics for the current user's canyoning activity.
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const [tripLogsWithCanyon, totalCanyons, canyonsWithTrips] =
      await Promise.all([
        prisma.tripLog.findMany({
          where: { userId: user.id },
          select: {
            date: true,
            canyonId: true,
            canyon: { select: { numAbseils: true } },
          },
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
    const distinctCanyons = new Set<string>();

    for (const t of tripLogsWithCanyon) {
      const dateStr = t.date.toISOString().split("T")[0];
      tripDates[dateStr] = (tripDates[dateStr] ?? 0) + 1;
      distinctDays.add(dateStr);
      if (t.canyonId) distinctCanyons.add(t.canyonId);

      if (t.canyon?.numAbseils != null) {
        totalAbseils = (totalAbseils ?? 0) + t.canyon.numAbseils;
      }
    }

    res.json({
      heroStats: {
        totalTrips: tripLogsWithCanyon.length,
        uniqueCanyons: distinctCanyons.size,
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
