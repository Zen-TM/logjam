import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { resolveUser } from "../lib/resolveUser";
import { deleteCanyonsCascade, deleteTripsCascade } from "../lib/bulkDelete";

const router = Router();

// DELETE /imports/:batchId — undo an entire import batch.
// Deletes ONLY rows created by that batch (stamped with importBatchId).
// Pre-existing canyons that were merged-into during the import are never
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

    // Find all canyons created by this batch for this user.
    const batchCanyons = await prisma.canyon.findMany({
      where: { ownerId: user.id, importBatchId: batchId },
      select: { id: true },
    });
    const canyonIds = batchCanyons.map((c) => c.id);

    // Delete trips first (they may reference the batch canyons), then canyons.
    // deleteTripsCascade handles S3 + media + quota; deleteCanyonsCascade
    // handles trips-via-canyon, media, shares, notifications, S3, quota.
    const deletedTripIds = await deleteTripsCascade(user.id, tripIds);

    // Canyon cascade also deletes any remaining trips referencing those canyons
    // (though the batch trips were already removed above — non-batch trips
    // linked to batch canyons also get cascaded, which is correct: the canyon
    // is being deleted).
    const deletedCanyonIds = await deleteCanyonsCascade(user.id, canyonIds);

    res.json({
      deletedCanyons: deletedCanyonIds.length,
      deletedTrips: deletedTripIds.length,
    });
  },
);

export default router;
