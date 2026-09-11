import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { mediaItemsByLinkedId } from "../lib/mediaPresign";
import { getPlaceRole } from "../lib/placeAccess";
import { resolveUser } from "../lib/resolveUser";
import { serializeTrip, tripPlacesInclude } from "./tripLogsGlobal";

const router = Router({ mergeParams: true });

// ── GET /places/:placeId/trips ──────────────────────────────
// Returns the caller's trip logs linked to a place — a filtered convenience
// view over GET /trips. All trip mutations live on the global /trips surface;
// the nested POST/PATCH/DELETE were removed with the trip↔place m2m cutover
// (the frontend never called them).
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const placeId = getParam(req.params.placeId);
    const place = await prisma.place.findUnique({ where: { id: placeId } });
    if (!place) throw new AppError(404, "Place not found");

    const role = await getPlaceRole(user.id, place);
    // 404 (not 403) so the status is no existence oracle for a place the
    // caller cannot see — matches GET /places/:id (requirePlaceAccess).
    if (role === "none") throw new AppError(404, "Place not found");
    if (role === "shared") {
      // Trip logs are owner-private (hybrid sharing model).
      res.json([]);
      return;
    }

    const trips = await prisma.tripLog.findMany({
      where: { userId: user.id, places: { some: { placeId } } },
      orderBy: { date: "desc" },
      include: tripPlacesInclude,
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
      trips.map((trip) => ({
        ...serializeTrip(trip),
        media: mediaByTrip.get(trip.id) ?? [],
      })),
    );
  },
);

export default router;
