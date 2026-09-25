import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { resolveUser } from "../lib/resolveUser";
import { deletePlacesCascade, deleteTripsCascade } from "../lib/bulkDelete";

const router = Router();

// DELETE /imports/:batchId — undo an entire import batch.
// Deletes ONLY rows created by that batch (stamped with importBatchId).
// Pre-existing places that were merged-into during the import are never
// stamped with importBatchId and therefore survive undo.
router.delete(
  "/:batchId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const { batchId } = req.params;

    if (!batchId || typeof batchId !== "string") {
      throw new AppError(400, "batchId is required");
    }

    // Find all trips created by this batch for this user.
    const batchTrips = await prisma.tripLog.findMany({
      where: { userId: user.id, importBatchId: batchId },
      select: { id: true },
    });
    const tripIds = batchTrips.map((t) => t.id);

    // Find all places created by this batch for this user.
    const batchPlaces = await prisma.place.findMany({
      where: { ownerId: user.id, importBatchId: batchId },
      select: { id: true },
    });
    const placeIds = batchPlaces.map((c) => c.id);

    // Delete trips first (they may reference the batch places), then places.
    // deleteTripsCascade handles S3 + media + quota; deletePlacesCascade
    // handles trips-via-place, media, shares, notifications, S3, quota.
    const deletedTripIds = await deleteTripsCascade(user.id, tripIds);

    // Place cascade also deletes any remaining trips referencing those places
    // (though the batch trips were already removed above — non-batch trips
    // linked to batch places also get cascaded, which is correct: the place
    // is being deleted).
    const deletedPlaceIds = await deletePlacesCascade(user.id, placeIds);

    res.json({
      deletedPlaces: deletedPlaceIds.length,
      deletedTrips: deletedTripIds.length,
    });
  },
);

export default router;
