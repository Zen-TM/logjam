import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { CANYONING_TRIP_TYPE } from "@logjam/shared";
import { resolveUser } from "../lib/resolveUser";

const router = Router();

// ── GET /analytics ─────────────────────────────────────────────
// Returns aggregate statistics for the current user's canyoning activity.
//
// "A canyoning trip" is identified by CANYON LINK first, tag second: linking a
// canyon to a trip means "I completed that canyon on that trip", so the link is
// the fact and the `canyoning` tag is a denormalized convenience. Filtering on
// the link makes these stats correct retroactively — trips logged before the
// tag was enforced (POST/PATCH /trips, via enforceCanyoningTag) still count,
// with no backfill.
//
// The tag branch is NOT vestigial: it counts the canyon-less canyoning trip —
// "I did a canyon that isn't in my library" — which has no link to match on and
// is otherwise counted only by displayName below.
const CANYONING_TRIP_WHERE = {
  OR: [{ canyons: { some: {} } }, { types: { has: CANYONING_TRIP_TYPE } }],
};

router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const [trips, totalTripsAllTypes, totalCanyons, canyonsWithTrips, typesRows] =
      await Promise.all([
        prisma.tripLog.findMany({
          where: { userId: user.id, ...CANYONING_TRIP_WHERE },
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
        // All the user's trips, canyoning or not. Lets the client show how many
        // trips the canyoning-scoped Activity chart is NOT showing (ANALYTICS-1).
        prisma.tripLog.count({ where: { userId: user.id } }),
        prisma.canyon.count({ where: { ownerId: user.id } }),
        // No user filter on tripLogLinks, deliberately — `ownerId` already
        // scopes this to the user's own canyons, and a link can only ever be to
        // one of them: resolveTripCanyonIds (routes/tripLogsGlobal.ts) rejects
        // any canyonId the requester doesn't own, so a sharee cannot link their
        // trip to your canyon. Correct today, but the invariant is enforced in
        // that other file — if trip↔canyon linking ever accepts a canyon the
        // trip's owner doesn't own, this count must grow a user filter.
        prisma.canyon.count({
          where: { ownerId: user.id, tripLogLinks: { some: {} } },
        }),
        // `distinct` can't dedupe on an array column the way it can on a
        // scalar — fetch every non-empty types[] and flatten/dedupe in JS.
        prisma.tripLog.findMany({
          where: { userId: user.id, types: { isEmpty: false } },
          select: { types: true },
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

    const types = Array.from(new Set(typesRows.flatMap((t) => t.types))).sort();

    res.json({
      heroStats: {
        totalTrips: trips.length,
        // Trips that are neither canyon-linked nor tagged canyoning — the count
        // the canyoning-scoped Activity chart omits.
        excludedTrips: totalTripsAllTypes - trips.length,
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
