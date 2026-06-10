import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";
import { getParam } from "../lib/getParam";
import { getEnv } from "../lib/env";
import { deleteS3Keys } from "../lib/s3Cleanup";
import { decrementStorageUsed } from "../lib/storageQuota";
import { toMediaItems, mediaItemsByLinkedId } from "../lib/mediaPresign";
import { requireCanyonAccess } from "../lib/canyonAccess";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

const router = Router();

async function fetchCanyons(where: object) {
  return prisma.canyon.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      _count: { select: { tripLogs: true } },
    },
  });
}

// GET /canyons — owned canyons
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");
    res.json(await fetchCanyons({ ownerId: user.id }));
  },
);

// GET /canyons/shared — canyons shared with me
router.get(
  "/shared",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");
    res.json(
      await fetchCanyons({ shares: { some: { sharedWithId: user.id } } }),
    );
  },
);

// ── POST /canyons ─────────────────────────────────────────────
// Creates a new canyon
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const {
      name,
      altNames,
      latitude,
      longitude,
      numAbseils,
      longestAbseil,
      vGrade,
      aGrade,
      commitment,
      quality,
      wetsuits,
      hours,

      notes,
      attributes,
    } = req.body;

    if (!name || latitude === undefined || longitude === undefined) {
      throw new AppError(400, "name, latitude, and longitude are required");
    }

    const canyon = await prisma.canyon.create({
      data: {
        ownerId: user.id,
        name,
        altNames: altNames ?? [],
        latitude,
        longitude,
        numAbseils,
        longestAbseil,
        vGrade,
        aGrade,
        commitment,
        quality,
        wetsuits,
        hours,
  
        notes,
        attributes: attributes ?? {},
      },
    });

    res.status(201).json(canyon);
  },
);

// ── POST /canyons/:id/copy ─────────────────────────────────────────────
// Copies a shared canyon
router.post(
  "/:id/copy",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyonId = getParam(req.params.id);
    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");

    // Owner and share recipients may copy (hybrid model: the canyon record
    // itself is visible to sharees).
    await requireCanyonAccess(user.id, canyon);

    // Create a copy of the canyon.
    // Drop ropeWikiId + ropeWikiSnapshot: @@unique([ownerId, ropeWikiId]) would
    // collide on self-copy, and preserving across owners would mis-attribute the
    // copy as the recipient's canonical RopeWiki record. Lineage is preserved
    // via forkedFromId; "forked from RopeWiki" is derivable from
    // forkedFrom.ropeWikiId if ever needed.
    const copiedCanyon = await prisma.canyon.create({
      data: {
        ownerId: user.id,
        name: canyon.name,
        altNames: canyon.altNames,
        latitude: canyon.latitude,
        longitude: canyon.longitude,
        numAbseils: canyon.numAbseils,
        longestAbseil: canyon.longestAbseil,
        vGrade: canyon.vGrade,
        aGrade: canyon.aGrade,
        commitment: canyon.commitment,
        quality: canyon.quality,
        wetsuits: canyon.wetsuits,
        hours: canyon.hours,
        notes: canyon.notes,
        attributes: canyon.attributes ?? Prisma.JsonNull,
        ropeWikiId: null,
        ropeWikiSnapshot: Prisma.JsonNull,
        forkedFromId: canyonId,
      },
    });

    res.status(201).json(copiedCanyon);
  },
);

// ── GET /canyons/:id ──────────────────────────────────────────
// Returns a single canyon. Owners receive trip logs + all media.
// Share recipients receive canyon record + canyon-level media only
// (trip logs and trip media are owner-private — hybrid sharing model).
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyonId = getParam(req.params.id);

    // Fetch owner first so we can decide includes before the full query.
    const stub = await prisma.canyon.findUnique({
      where: { id: canyonId },
      select: { ownerId: true },
    });
    if (!stub) throw new AppError(404, "Canyon not found");

    const role = await requireCanyonAccess(user.id, {
      id: canyonId,
      ownerId: stub.ownerId,
    });
    const isOwner = role === "owner";

    // Media is polymorphic with no FK relation, so it's fetched by
    // (linkedType, linkedId) and presigned here. Owners also get trip logs and
    // their media; share recipients receive canyon-level media only.
    if (isOwner) {
      const canyon = await prisma.canyon.findUnique({
        where: { id: canyonId },
        include: { tripLogs: { orderBy: { date: "desc" } } },
      });
      if (!canyon) throw new AppError(404, "Canyon not found");

      const tripIds = canyon.tripLogs.map((trip) => trip.id);
      const [canyonMedia, tripMediaRows] = await Promise.all([
        prisma.media.findMany({
          where: { linkedType: "canyon", linkedId: canyonId },
          orderBy: { createdAt: "asc" },
        }),
        tripIds.length
          ? prisma.media.findMany({
              where: { linkedType: "tripLog", linkedId: { in: tripIds } },
              orderBy: { createdAt: "asc" },
            })
          : [],
      ]);

      const mediaByTrip = await mediaItemsByLinkedId(tripMediaRows);
      const tripLogs = canyon.tripLogs.map((trip) => ({
        ...trip,
        media: mediaByTrip.get(trip.id) ?? [],
      }));
      res.json({ ...canyon, media: await toMediaItems(canyonMedia), tripLogs });
      return;
    }

    const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
    if (!canyon) throw new AppError(404, "Canyon not found");
    const canyonMedia = await prisma.media.findMany({
      where: { linkedType: "canyon", linkedId: canyonId },
      orderBy: { createdAt: "asc" },
    });
    res.json({ ...canyon, media: await toMediaItems(canyonMedia) });
  },
);

// ── PATCH /canyons/:id ────────────────────────────────────────
// Updates an existing canyon (owner only)
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyon = await prisma.canyon.findUnique({
      where: { id: getParam(req.params.id) },
    });

    if (!canyon) throw new AppError(404, "Canyon not found");
    if (canyon.ownerId !== user.id)
      throw new AppError(403, "Only the owner can edit a canyon");

    const {
      name,
      altNames,
      latitude,
      longitude,
      numAbseils,
      longestAbseil,
      vGrade,
      aGrade,
      commitment,
      quality,
      wetsuits,
      hours,

      notes,
      attributes,
    } = req.body;

    const updated = await prisma.canyon.update({
      where: { id: getParam(req.params.id) },
      data: {
        ...(name !== undefined && { name }),
        ...(altNames !== undefined && { altNames }),
        ...(latitude !== undefined && { latitude }),
        ...(longitude !== undefined && { longitude }),
        ...(numAbseils !== undefined && { numAbseils }),
        ...(longestAbseil !== undefined && { longestAbseil }),
        ...(vGrade !== undefined && { vGrade }),
        ...(aGrade !== undefined && { aGrade }),
        ...(commitment !== undefined && { commitment }),
        ...(quality !== undefined && { quality }),
        ...(wetsuits !== undefined && { wetsuits }),
        ...(hours !== undefined && { hours }),
        ...(notes !== undefined && { notes }),
        ...(attributes !== undefined && {
          attributes: attributes ?? Prisma.JsonNull,
        }),
      },
    });

    res.json(updated);
  },
);

// ── DELETE /canyons/:id ───────────────────────────────────────
// Deletes a canyon and all associated data (owner only)
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const canyon = await prisma.canyon.findUnique({
      where: { id: getParam(req.params.id) },
    });

    if (!canyon) throw new AppError(404, "Canyon not found");
    if (canyon.ownerId !== user.id)
      throw new AppError(403, "Only the owner can delete a canyon");

    const id = getParam(req.params.id);

    const tripIds = (
      await prisma.tripLog.findMany({
        where: { canyonId: id },
        select: { id: true },
      })
    ).map((t) => t.id);

    const media = await prisma.media.findMany({
      where: {
        OR: [
          { linkedType: "tripLog", linkedId: { in: tripIds } },
          { linkedType: "canyon", linkedId: id },
        ],
      },
      select: { s3KeyDisplay: true, s3KeyThumbnail: true, fileSizeBytes: true },
    });

    // S3-first (ARCH-004): the media S3 keys are already captured in `media`
    // above, so delete the blobs before the DB rows. deleteS3Keys throws on
    // failure (CH-002), aborting before any row is removed — no orphaned blobs,
    // and the DB still holds the canyon/media if a retry is needed.
    const s3Keys = media.flatMap((m) =>
      [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
    );
    const totalBytes = media.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0n), 0n);
    await deleteS3Keys(MEDIA_BUCKET, s3Keys);

    // Trip logs, canyon shares and (since the cascade migration) canyon-linked
    // children all FK-cascade on canyon delete, but media has no DB FK on its
    // polymorphic linkedId — keep its deleteMany explicit.
    await prisma.$transaction([
      prisma.media.deleteMany({
        where: { linkedType: "tripLog", linkedId: { in: tripIds } },
      }),
      prisma.media.deleteMany({
        where: { linkedType: "canyon", linkedId: id },
      }),
      prisma.tripLog.deleteMany({ where: { canyonId: id } }),
      prisma.canyonShare.deleteMany({ where: { canyonId: id } }),
      // Purge canyon_shared notifications held by OTHER users (the share
      // recipients) that reference this canyon — not just the owner's own rows
      // (PRIV-003). The read-time filter would hide them, but deletion removes
      // the residual record at rest.
      prisma.notification.deleteMany({
        where: {
          type: "canyon_shared",
          payload: { path: ["canyonId"], equals: id },
        },
      }),
      prisma.canyon.delete({ where: { id } }),
    ]);

    await decrementStorageUsed(user.id, totalBytes);

    res.status(204).send();
  },
);

export default router;
