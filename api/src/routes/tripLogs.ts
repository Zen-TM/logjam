import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { mediaItemsByLinkedId } from "../lib/mediaPresign";
import { getCanyonRole } from "../lib/canyonAccess";
import { resolveUser } from "../lib/resolveUser";
import { serializeTrip, tripCanyonsInclude } from "./tripLogsGlobal";

const router = Router({ mergeParams: true });

// ── GET /canyons/:canyonId/trips ──────────────────────────────
// Returns the caller's trip logs linked to a canyon — a filtered convenience
// view over GET /trips. All trip mutations live on the global /trips surface;
// the nested POST/PATCH/DELETE were removed with the trip↔canyon m2m cutover
// (the frontend never called them).
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const canyonId = getParam(req.params.canyonId);
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");

    const role = await getCanyonRole(user.id, canyon);
    // 404 (not 403) so the status is no existence oracle for a canyon the
    // caller cannot see — matches GET /canyons/:id (requireCanyonAccess).
    if (role === "none") throw new AppError(404, "Canyon not found");
    if (role === "shared") {
      // Trip logs are owner-private (hybrid sharing model).
      res.json([]);
      return;
    }

    const trips = await prisma.tripLog.findMany({
      where: { userId: user.id, canyons: { some: { canyonId } } },
      orderBy: { date: "desc" },
      include: tripCanyonsInclude,
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
