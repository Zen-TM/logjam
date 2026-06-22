import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";
import { getParam } from "../lib/getParam";
import { getEnv } from "../lib/env";
import { deleteS3Keys } from "../lib/s3Cleanup";
import { decrementStorageUsed } from "../lib/storageQuota";
import { toMediaItems } from "../lib/mediaPresign";
import { resolveUser } from "../lib/resolveUser";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

const router = Router();

// Validates that, when a canyonId is supplied, it exists and is owned by the
// current user. Returns the canyonId to persist (null when unassigned).
async function resolveTripCanyonId(
  userId: string,
  canyonId: unknown,
): Promise<string | null> {
  if (canyonId === undefined || canyonId === null) return null;
  if (typeof canyonId !== "string")
    throw new AppError(400, "canyonId must be a string or null");

  const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
  if (!canyon) throw new AppError(404, "Canyon not found");
  if (canyon.ownerId !== userId)
    throw new AppError(403, "Only the canyon owner can add trip logs");
  return canyon.id;
}

// ── GET /trips ────────────────────────────────────────────────
// Returns all trip logs owned by the current user across all canyons
// Query params: ?search= (canyon name), ?dateFrom=, ?dateTo=
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const { search, dateFrom, dateTo } = req.query as {
      search?: string;
      dateFrom?: string;
      dateTo?: string;
    };

    // Same owner-filtered where for the page and the count, so X-Total-Count
    // reflects exactly the set being truncated by the cap (UX-001).
    const where = {
      userId: user.id,
      ...(search
        ? {
            OR: [
              { canyon: { name: { contains: search, mode: "insensitive" } } },
              { displayName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    } satisfies Prisma.TripLogWhereInput;

    // Hard cap on the list; the body stays a bare array (consumers depend on
    // that shape) and the true total rides the X-Total-Count header so the UI
    // can show "Showing N of TOTAL" without a response-shape change (UX-001).
    const TRIP_LIST_TAKE = 500;
    const [trips, total] = await Promise.all([
      prisma.tripLog.findMany({
        where,
        orderBy: { date: "desc" },
        take: TRIP_LIST_TAKE,
        include: {
          canyon: { select: { id: true, name: true } },
        },
      }),
      prisma.tripLog.count({ where }),
    ]);

    res.set("X-Total-Count", String(total));
    res.json(trips);
  },
);

// ── GET /trips/:id ────────────────────────────────────────────
// Returns a single trip log (owner-only) with presigned media.
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    const trip = await prisma.tripLog.findUnique({
      where: { id },
      include: { canyon: { select: { id: true, name: true } } },
    });
    // Owner-private resource — 404 (not 403) for non-owners so the response
    // is no existence oracle for trip IDs (SEC-001).
    if (!trip || trip.userId !== user.id)
      throw new AppError(404, "Trip log not found");

    const mediaRows = await prisma.media.findMany({
      where: { linkedType: "tripLog", linkedId: id },
      orderBy: { createdAt: "asc" },
    });
    res.json({ ...trip, media: await toMediaItems(mediaRows) });
  },
);

// ── POST /trips ───────────────────────────────────────────────
// Creates a trip log, optionally associated with a canyon (canyonId omitted
// or null = unassigned).
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const { date, notes, customFields, canyonId, displayName } = req.body;
    if (!date) throw new AppError(400, "date is required");

    const resolvedCanyonId = await resolveTripCanyonId(user.id, canyonId);
    const trimmedDisplayName =
      typeof displayName === "string" ? displayName.trim() : null;

    if (!resolvedCanyonId && !trimmedDisplayName)
      throw new AppError(400, "A canyon or trip name is required");

    const trip = await prisma.tripLog.create({
      data: {
        canyonId: resolvedCanyonId,
        userId: user.id,
        date: new Date(date),
        displayName: resolvedCanyonId ? null : trimmedDisplayName,
        notes,
        customFields: customFields ?? {},
      },
    });

    res.status(201).json(trip);
  },
);

// ── PATCH /trips/:id ──────────────────────────────────────────
// Updates a trip log. Supports reassigning the canyon (including to null).
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    const trip = await prisma.tripLog.findUnique({ where: { id } });
    // Owner-private resource — 404 (not 403) for non-owners (SEC-001).
    if (!trip || trip.userId !== user.id)
      throw new AppError(404, "Trip log not found");

    const { date, notes, customFields, canyonId, displayName } = req.body;

    const resolvedCanyonId =
      canyonId !== undefined
        ? await resolveTripCanyonId(user.id, canyonId)
        : undefined;

    const updated = await prisma.tripLog.update({
      where: { id },
      data: {
        ...(date !== undefined && { date: new Date(date) }),
        ...(notes !== undefined && { notes }),
        ...(customFields !== undefined && {
          customFields: customFields ?? Prisma.JsonNull,
        }),
        ...(resolvedCanyonId !== undefined && { canyonId: resolvedCanyonId }),
        // When a canyon marker is set, clear displayName (the two never coexist).
        // Otherwise accept an explicit displayName update.
        ...(resolvedCanyonId
          ? { displayName: null }
          : displayName !== undefined && {
              displayName:
                typeof displayName === "string"
                  ? displayName.trim() || null
                  : null,
            }),
      },
    });

    res.json(updated);
  },
);

// ── DELETE /trips/:id ─────────────────────────────────────────
// Deletes a trip log and its media (owner-only).
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    const trip = await prisma.tripLog.findUnique({ where: { id } });
    // Owner-private resource — 404 (not 403) for non-owners (SEC-001).
    if (!trip || trip.userId !== user.id)
      throw new AppError(404, "Trip log not found");

    const media = await prisma.media.findMany({
      where: { linkedType: "tripLog", linkedId: id },
      select: { s3KeyDisplay: true, s3KeyThumbnail: true, fileSizeBytes: true },
    });

    // S3-first (ARCH-004): blobs go before the rows, so an S3 failure leaves
    // the rows (and therefore the keys) intact for a retried DELETE. The row
    // deletes and the quota decrement then share one transaction so a crash
    // between them can't leave the quota over-counted.
    const s3Keys = media.flatMap((m) =>
      [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
    );
    const totalBytes = media.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0n), 0n);
    await deleteS3Keys(MEDIA_BUCKET, s3Keys);

    await prisma.$transaction(async (tx) => {
      await tx.media.deleteMany({
        where: { linkedType: "tripLog", linkedId: id },
      });
      await tx.tripLog.delete({ where: { id } });
      await decrementStorageUsed(user.id, totalBytes, tx);
    });

    res.status(204).send();
  },
);

export default router;
