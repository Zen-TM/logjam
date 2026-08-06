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
import { requireCanyonAccess, requireCanyonOwnerAccess } from "../lib/canyonAccess";
import { resolveUser } from "../lib/resolveUser";
import { canyonDeleteTombstones, writeTombstones } from "../lib/syncTombstones";
import {
  assertClientIdReplayable,
  parseClientSuppliedId,
} from "../lib/clientSuppliedId";
import { TRACK_MIME_TYPES, validateCanyonPayload } from "@logjam/shared";
import { serializeTrip, tripCanyonsInclude } from "./tripLogsGlobal";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

const router = Router();

// Hard cap on list responses. The body stays a bare array (consumers depend on
// that shape); when the result hits the cap the true owner-filtered total is
// surfaced via the X-Total-Count header so the UI can show "Showing N of TOTAL"
// without a response-shape change (UX-001).
const LIST_TAKE = 500;

// Which list a fetch is serving. This is an ACCESS decision, not a formatting
// one — see canyonListInclude.
export type CanyonListScope = "owned" | "shared";

// Per-canyon `_count` is OWNER-PRIVATE and rides the OWNED list only.
//
// Under the hybrid share model a recipient sees the canyon RECORD (plus
// canyon-level notes/media); the trip-log list is owner-private. `tripLogLinks`
// is precisely that list's cardinality, and `shares` is the owner's share
// fan-out — how many other people they showed the canyon to. Neither is part of
// the record a sharee is entitled to, so neither may be serialised onto the
// shared list.
//
// This must be enforced HERE rather than by the client declining to render it:
// the counts previously rode both lists and were merely ignored by the panel,
// which is not a boundary — it's a client that happens to look away. Anyone with
// devtools, or any future client, saw them (the SEC-001 shape).
//
// On the owned list the counts are the owner's own data: `shares` powers the
// "shared by me" filter + card badge, `tripLogLinks` the completion filter +
// per-row trip count.
export function canyonListInclude(
  scope: CanyonListScope,
): Prisma.CanyonInclude | undefined {
  if (scope === "shared") return undefined;
  return { _count: { select: { tripLogLinks: true, shares: true } } };
}

async function fetchCanyons(
  where: Prisma.CanyonWhereInput,
  scope: CanyonListScope,
) {
  return prisma.canyon.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: LIST_TAKE,
    include: canyonListInclude(scope),
  });
}

// GET /canyons — owned canyons
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const where = { ownerId: user.id };
    const [rows, total] = await Promise.all([
      fetchCanyons(where, "owned"),
      prisma.canyon.count({ where }),
    ]);
    res.set("X-Total-Count", String(total));
    res.json(rows);
  },
);

// GET /canyons/shared — canyons shared with me.
// Scope "shared" drops the owner-private `_count` (trip tally + share fan-out)
// — see canyonListInclude.
router.get(
  "/shared",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const where = { shares: { some: { sharedWithId: user.id } } };
    const [rows, total] = await Promise.all([
      fetchCanyons(where, "shared"),
      prisma.canyon.count({ where }),
    ]);
    res.set("X-Total-Count", String(total));
    res.json(rows);
  },
);

// GET /canyons/tracks — track (GPX/KML) media for every canyon the user can
// access (owned + shared), for the map track layer. Derived purely from the
// user's own access set, so it never accepts an arbitrary id and preserves the
// 404-not-403 anti-oracle: a canyon the user can't see is simply absent.
// Returns minimal projection (no coords/names) — only the presigned track URL
// and its colour.
router.get(
  "/tracks",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const accessible = await prisma.canyon.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          { shares: { some: { sharedWithId: user.id } } },
        ],
      },
      select: { id: true },
    });
    const canyonIds = accessible.map((canyon) => canyon.id);
    if (canyonIds.length === 0) {
      res.json([]);
      return;
    }
    const rows = await prisma.media.findMany({
      where: {
        linkedType: "canyon",
        linkedId: { in: canyonIds },
        mediaType: { in: TRACK_MIME_TYPES as unknown as string[] },
      },
      orderBy: { createdAt: "asc" },
    });
    const items = await toMediaItems(rows);
    res.json(
      items.map((item) => ({
        canyonId: item.linkedId,
        mediaId: item.id,
        color: item.color,
        displayUrl: item.displayUrl,
      })),
    );
  },
);

// ── POST /canyons ─────────────────────────────────────────────
// Creates a new canyon
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

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
      hours,

      notes,
      attributes,
    } = req.body;

    if (!name || latitude === undefined || longitude === undefined) {
      throw new AppError(400, "name, latitude, and longitude are required");
    }

    // Validate coordinate + numeric-field ranges (CANYON-1/CANYON-2). Same
    // ranges as the CSV bulk-import path, sourced from @logjam/shared.
    const validationError = validateCanyonPayload(req.body, {
      requireCoords: true,
    });
    if (validationError) throw new AppError(400, validationError);

    // Optional client-minted id (Stage 8 §3.5): own-id replay → 200 with the
    // existing row; foreign id → 404 (see lib/clientSuppliedId.ts).
    const clientId = parseClientSuppliedId(req.body.id);
    if (clientId) {
      const existing = await prisma.canyon.findUnique({
        where: { id: clientId },
      });
      if (existing) {
        assertClientIdReplayable(existing.ownerId, user.id, "Canyon not found");
        res.status(200).json(existing);
        return;
      }
    }

    let canyon;
    try {
      canyon = await prisma.canyon.create({
        data: {
          ...(clientId && { id: clientId }),
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
          hours,

          notes,
          attributes: attributes ?? {},
        },
      });
    } catch (err) {
      // Concurrent replay of the same client id (retried flush racing an
      // in-flight request) — return the winner's row, mirroring media-confirm.
      if (
        clientId &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const winner = await prisma.canyon.findUnique({ where: { id: clientId } });
        if (winner && winner.ownerId === user.id) {
          res.status(200).json(winner);
          return;
        }
      }
      throw err;
    }

    res.status(201).json(canyon);
  },
);

// ── POST /canyons/:id/copy ─────────────────────────────────────────────
// Copies a shared canyon
router.post(
  "/:id/copy",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

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
        hours: canyon.hours,
        notes: canyon.notes,
        attributes: canyon.attributes ?? Prisma.JsonNull,
        ropeWikiId: null,
        ropeWikiSnapshot: Prisma.JsonNull,
        forkedFromId: canyonId,
      },
    });

    // The linked route is copied with the canyon — deliberately UNLIKE media,
    // which a copy does not duplicate. A route is one row the copier now owns;
    // media is S3 objects plus a quota charge. The route is also the single
    // most useful thing to receive with a copied canyon, and the copier can
    // already see it (a linked route is part of the shared canyon record).
    const sourceRoute = await prisma.route.findUnique({
      where: { canyonId },
      select: { name: true, color: true, points: true },
    });
    if (sourceRoute) {
      await prisma.route.create({
        data: {
          ownerId: user.id,
          canyonId: copiedCanyon.id,
          name: sourceRoute.name,
          color: sourceRoute.color,
          points: sourceRoute.points as Prisma.InputJsonValue,
        },
      });
    }

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
    const user = await resolveUser(req.user!.sub);

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
      const canyon = await prisma.canyon.findUnique({ where: { id: canyonId } });
      if (!canyon) throw new AppError(404, "Canyon not found");

      // Join-based lookup (Canyon no longer has a direct tripLogs relation —
      // trips link via TripLogCanyon, possibly to several canyons). Mirrors
      // GET /canyons/:canyonId/trips (routes/tripLogs.ts).
      const trips = await prisma.tripLog.findMany({
        where: { userId: user.id, canyons: { some: { canyonId } } },
        orderBy: { date: "desc" },
        include: tripCanyonsInclude,
      });

      const tripIds = trips.map((trip) => trip.id);
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
      const tripLogs = trips.map((trip) => ({
        ...serializeTrip(trip),
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
    const user = await resolveUser(req.user!.sub);

    const canyon = await prisma.canyon.findUnique({
      where: { id: getParam(req.params.id) },
    });

    if (!canyon) throw new AppError(404, "Canyon not found");
    await requireCanyonOwnerAccess(
      user.id,
      canyon,
      "Only the owner can edit a canyon",
    );

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
      hours,

      notes,
      attributes,
    } = req.body;

    // Validate any supplied coordinate/numeric field (CANYON-1/CANYON-2).
    // requireCoords:false — PATCH may omit fields; only validate what's present.
    const validationError = validateCanyonPayload(req.body, {
      requireCoords: false,
    });
    if (validationError) throw new AppError(400, validationError);

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
    const user = await resolveUser(req.user!.sub);

    const canyon = await prisma.canyon.findUnique({
      where: { id: getParam(req.params.id) },
    });

    if (!canyon) throw new AppError(404, "Canyon not found");
    await requireCanyonOwnerAccess(
      user.id,
      canyon,
      "Only the owner can delete a canyon",
    );

    const id = getParam(req.params.id);

    const media = await prisma.media.findMany({
      where: { linkedType: "canyon", linkedId: id },
      select: {
        id: true,
        s3KeyDisplay: true,
        s3KeyThumbnail: true,
        fileSizeBytes: true,
      },
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

    // Trip logs DETACH on canyon delete (the TripLogCanyon join row cascades
    // away, not the trip), so a user removing a canyon keeps their personal
    // logbook entries and their per-trip media. Canyon shares and any other
    // canyon-linked children still FK-cascade; canyon-level media has no DB FK
    // on its polymorphic linkedId, so its deleteMany stays explicit. The quota
    // decrement shares the transaction (ARCH-004) so a crash after the row
    // deletes can't leave the quota over-counted (only canyon media frees
    // quota now — per-trip media survives with its trip).
    await prisma.$transaction(async (tx) => {
      await tx.media.deleteMany({
        where: { linkedType: "canyon", linkedId: id },
      });
      // Preserve the (about-to-be-deleted) canyon's name on trips for which
      // this was their ONLY linked canyon, so they still carry a label once
      // the join row cascades away. Trips that keep another linked canyon
      // need no backfill (their title still derives from the survivor). Only
      // fill blanks so an explicit trip displayName is never overwritten.
      // Queried before canyon.delete below, while the join row still exists.
      const soleLinkTrips = await tx.tripLog.findMany({
        where: { displayName: null, canyons: { some: { canyonId: id } } },
        select: { id: true, _count: { select: { canyons: true } } },
      });
      const orphanedTripIds = soleLinkTrips
        .filter((trip) => trip._count.canyons === 1)
        .map((trip) => trip.id);
      if (orphanedTripIds.length > 0) {
        await tx.tripLog.updateMany({
          where: { id: { in: orphanedTripIds } },
          data: { displayName: canyon.name },
        });
      }
      // Queried before the deleteMany below, while the share rows still exist:
      // each sharee must be told to forget the canyon + its canyon-level media
      // (sync tombstone fan-out — same transaction as the delete).
      const shares = await tx.canyonShare.findMany({
        where: { canyonId: id },
        select: { id: true, sharedWithId: true },
      });
      // The linked route (if any) SURVIVES this delete — Route.canyonId is
      // SetNull, so it becomes standalone and the owner keeps it. Only the
      // sharees lose sight of it, which needs a tombstone each.
      const linkedRoute = await tx.route.findUnique({
        where: { canyonId: id },
        select: { id: true },
      });
      await writeTombstones(
        tx,
        canyonDeleteTombstones({
          ownerId: user.id,
          canyonId: id,
          mediaIds: media.map((m) => m.id),
          shares,
          routeId: linkedRoute?.id ?? null,
        }),
      );
      await tx.canyonShare.deleteMany({ where: { canyonId: id } });
      // Purge canyon_shared notifications held by OTHER users (the share
      // recipients) that reference this canyon — not just the owner's own rows
      // (PRIV-003). The read-time filter would hide them, but deletion removes
      // the residual record at rest.
      await tx.notification.deleteMany({
        where: {
          type: "canyon_shared",
          payload: { path: ["canyonId"], equals: id },
        },
      });
      await tx.canyon.delete({ where: { id } });
      await decrementStorageUsed(user.id, totalBytes, tx);
    });

    res.status(204).send();
  },
);

export default router;
