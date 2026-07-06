import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { resolveUser } from "../lib/resolveUser";

const router = Router();

// ── GET /analytics ─────────────────────────────────────────────
// Returns aggregate statistics for the current user's canyoning activity.
// Optional ?type= filters the trip-derived stats (heroStats, tripDates) to an
// exact TripLog.type match; `types` is always computed unfiltered so the UI
// dropdown can offer every type the user has ever used.
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const { type } = req.query as { type?: string };
    if (type !== undefined && typeof type !== "string") {
      throw new AppError(400, "type must be a string");
    }

    const [trips, totalCanyons, canyonsWithTrips, distinctTypeRows] =
      await Promise.all([
        prisma.tripLog.findMany({
          where: { userId: user.id, ...(type ? { type } : {}) },
          select: {
            date: true,
            displayName: true,
            canyons: {
              select: {
                canyonId: true,
                canyon: { select: { numAbseils: true } },
              },
            },
          },
        }),
        prisma.canyon.count({ where: { ownerId: user.id } }),
        prisma.canyon.count({
          where: { ownerId: user.id, tripLogLinks: { some: {} } },
        }),
        prisma.tripLog.findMany({
          where: { userId: user.id, type: { not: null } },
          select: { type: true },
          distinct: ["type"],
        }),
      ]);

    // Aggregate trip dates into { "YYYY-MM-DD": count }
    const tripDates: Record<string, number> = {};
    let totalAbseils: number | null = null;
    const distinctDays = new Set<string>();
    const distinctCanyons = new Set<string>();

    for (const t of trips) {
      const dateStr = t.date.toISOString().split("T")[0];
      tripDates[dateStr] = (tripDates[dateStr] ?? 0) + 1;
      distinctDays.add(dateStr);

      if (t.canyons.length > 0) {
        // Every linked canyon of a (now possibly multi-canyon) trip counts
        // toward uniqueCanyons and contributes its own abseil count.
        for (const link of t.canyons) {
          distinctCanyons.add("id:" + link.canyonId);
          if (link.canyon?.numAbseils != null) {
            totalAbseils = (totalAbseils ?? 0) + link.canyon.numAbseils;
          }
        }
      } else if (t.displayName) {
        // Canyon-less trip with a label — counted by name for continuity with
        // the pre-join-table behavior (a trip is "a canyon" for this stat even
        // without a linked Canyon row).
        distinctCanyons.add("dn:" + t.displayName);
      }
    }

    const types = distinctTypeRows
      .map((t) => t.type)
      .filter((t): t is string => t != null)
      .sort();

    res.json({
      heroStats: {
        totalTrips: trips.length,
        uniqueCanyons: distinctCanyons.size,
        daysCanyoning: distinctDays.size,
        totalAbseils,
      },
      completion: {
        totalCanyons,
        canyonsWithTrips,
      },
      tripDates,
      types,
    });
  },
);

export default router;
