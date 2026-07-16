import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { CANYONING_TRIP_TYPE } from "@logjam/shared";
import { resolveUser } from "../lib/resolveUser";

const router = Router();

// ── GET /analytics ─────────────────────────────────────────────
// Returns aggregate statistics for the current user.
//
// Two scopes live here, deliberately different:
//   • Hero stats (totalTrips, uniqueCanyons, daysCanyoning, totalAbseils) are
//     CANYONING-scoped — "Canyon Trips", "Days Canyoning" etc. only make sense
//     over canyoning trips.
//   • tripDates (the Activity calendar) counts ALL trips of every type — it's a
//     general activity heatmap, not a canyoning one.
//
// "A canyoning trip" is identified by CANYON LINK first, tag second: linking a
// canyon to a trip means "I completed that canyon on that trip", so the link is
// the fact and the `canyoning` tag is a denormalized convenience. Filtering on
// the link makes the hero stats correct retroactively — trips logged before the
// tag was enforced (POST/PATCH /trips, via enforceCanyoningTag) still count,
// with no backfill. The tag branch is NOT vestigial: it catches the canyon-less
// canyoning trip — "I did a canyon that isn't in my library" — which has no link
// to match on and is otherwise counted only by displayName below.
function isCanyoningTrip(trip: { canyons: unknown[]; types: string[] }): boolean {
  return trip.canyons.length > 0 || trip.types.includes(CANYONING_TRIP_TYPE);
}

router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const [allTrips, totalCanyons, canyonsWithTrips] = await Promise.all([
      // Every trip of every type: tripDates counts them all, hero stats filter
      // to the canyoning subset in JS, and the type vocabulary is derived from
      // their types[] (no separate query needed).
      prisma.tripLog.findMany({
        where: { userId: user.id },
        select: {
          date: true,
          displayName: true,
          types: true,
          canyons: {
            select: {
              canyonId: true,
              canyon: { select: { numAbseils: true } },
            },
          },
        },
      }),
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
    ]);

    // tripDates counts ALL trips; the hero-stat accumulators only advance for
    // the canyoning subset.
    const tripDates: Record<string, number> = {};
    let totalCanyoningTrips = 0;
    let totalAbseils: number | null = null;
    const distinctDays = new Set<string>();
    const distinctCanyons = new Set<string>();

    for (const t of allTrips) {
      const dateStr = t.date.toISOString().split("T")[0];
      tripDates[dateStr] = (tripDates[dateStr] ?? 0) + 1;

      if (!isCanyoningTrip(t)) continue;
      totalCanyoningTrips++;
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

    const types = Array.from(new Set(allTrips.flatMap((t) => t.types))).sort();

    res.json({
      heroStats: {
        totalTrips: totalCanyoningTrips,
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
