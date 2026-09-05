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
//   • Hero stats (totalTrips, uniquePlaces, daysCanyoning, totalAbseils) are
//     CANYONING-scoped — "Place Trips", "Days Canyoning" etc. only make sense
//     over canyoning trips.
//   • tripDates (the Activity calendar) counts ALL trips of every type — it's a
//     general activity heatmap, not a canyoning one.
//
// "A canyoning trip" is identified by PLACE LINK first, tag second: linking a
// place to a trip means "I completed that place on that trip", so the link is
// the fact and the `canyoning` tag is a denormalized convenience. Filtering on
// the link makes the hero stats correct retroactively — trips logged before the
// tag was enforced (POST/PATCH /trips, via enforceCanyoningTag) still count,
// with no backfill. The tag branch is NOT vestigial: it catches the place-less
// canyoning trip — "I did a place that isn't in my library" — which has no link
// to match on and is otherwise counted only by displayName below.
function isCanyoningTrip(trip: { places: unknown[]; types: string[] }): boolean {
  return trip.places.length > 0 || trip.types.includes(CANYONING_TRIP_TYPE);
}

router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const [allTrips, totalPlaces, placesWithTrips] = await Promise.all([
      // Every trip of every type: tripDates counts them all, hero stats filter
      // to the canyoning subset in JS, and the type vocabulary is derived from
      // their types[] (no separate query needed).
      prisma.tripLog.findMany({
        where: { userId: user.id },
        select: {
          date: true,
          displayName: true,
          types: true,
          places: {
            select: {
              placeId: true,
              place: { select: { numAbseils: true } },
            },
          },
        },
      }),
      prisma.place.count({ where: { ownerId: user.id } }),
      // No user filter on tripLogLinks, deliberately — `ownerId` already
      // scopes this to the user's own places, and a link can only ever be to
      // one of them: resolveTripPlaceIds (routes/tripLogsGlobal.ts) rejects
      // any placeId the requester doesn't own, so a sharee cannot link their
      // trip to your place. Correct today, but the invariant is enforced in
      // that other file — if trip↔place linking ever accepts a place the
      // trip's owner doesn't own, this count must grow a user filter.
      prisma.place.count({
        where: { ownerId: user.id, tripLogLinks: { some: {} } },
      }),
    ]);

    // tripDates counts ALL trips; the hero-stat accumulators only advance for
    // the canyoning subset.
    const tripDates: Record<string, number> = {};
    let totalCanyoningTrips = 0;
    let totalAbseils: number | null = null;
    const distinctDays = new Set<string>();
    const distinctPlaces = new Set<string>();

    for (const t of allTrips) {
      const dateStr = t.date.toISOString().split("T")[0];
      tripDates[dateStr] = (tripDates[dateStr] ?? 0) + 1;

      if (!isCanyoningTrip(t)) continue;
      totalCanyoningTrips++;
      distinctDays.add(dateStr);

      if (t.places.length > 0) {
        // Every linked place of a (now possibly multi-place) trip counts
        // toward uniquePlaces and contributes its own abseil count.
        for (const link of t.places) {
          distinctPlaces.add("id:" + link.placeId);
          if (link.place?.numAbseils != null) {
            totalAbseils = (totalAbseils ?? 0) + link.place.numAbseils;
          }
        }
      } else if (t.displayName) {
        // Place-less trip with a label — counted by name for continuity with
        // the pre-join-table behavior (a trip is "a place" for this stat even
        // without a linked Place row).
        distinctPlaces.add("dn:" + t.displayName);
      }
    }

    const types = Array.from(new Set(allTrips.flatMap((t) => t.types))).sort();

    res.json({
      heroStats: {
        totalTrips: totalCanyoningTrips,
        uniquePlaces: distinctPlaces.size,
        daysCanyoning: distinctDays.size,
        totalAbseils,
      },
      completion: {
        totalPlaces,
        placesWithTrips,
      },
      tripDates,
      types,
    });
  },
);

export default router;
