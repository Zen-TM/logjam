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
import { partitionPlaceMedia, unlinkStandaloneMedia } from "../lib/mediaLink";
import { requirePlaceAccess, requirePlaceOwnerAccess } from "../lib/placeAccess";
import { resolveUser } from "../lib/resolveUser";
import { placeDeleteTombstones, writeTombstones } from "../lib/syncTombstones";
import {
  snapshotPlaceWaypointVisibility,
  writeWaypointVisibilityLoss,
} from "../lib/waypointLink";
import {
  assertClientIdReplayable,
  parseClientSuppliedId,
} from "../lib/clientSuppliedId";
import { TRACK_MIME_TYPES, validatePlacePayload } from "@logjam/shared";
import { serializeTrip, tripPlacesInclude } from "./tripLogsGlobal";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

// Bounds for the free-text place fields. `validatePlacePayload` (shared)
// covers coordinates + numerics only, so a mistyped `name`/`altNames`/`notes`/
// `attributes` used to sail past validation and die inside Prisma as a raw 500
// — and on the sync push path, one such op poisoned every subsequent flush of
// that batch (the per-op catch re-throws non-AppErrors). Bad input is a 400.
// Sibling values: TRIP_NAME_MAX_LENGTH / ROUTE_NAME_MAX_LENGTH = 200.
export const PLACE_NAME_MAX_LENGTH = 200;
export const PLACE_MAX_ALT_NAMES = 50;

/**
 * Type/shape check for the place fields `validatePlacePayload` does not
 * cover. Returns the first user-facing error string, or null when valid.
 * A field that is `undefined` is absent (PATCH leaves it unchanged); create
 * separately requires name/latitude/longitude.
 *
 * Exported for the sync push path — REST and sync must reject identically
 * (§8.1 validation parity), which is the SEC-001 failure mode when they drift.
 */
export function validatePlaceTextFields(payload: {
  name?: unknown;
  altNames?: unknown;
  notes?: unknown;
  attributes?: unknown;
}): string | null {
  const { name, altNames, notes, attributes } = payload;

  if (name !== undefined) {
    if (typeof name !== "string") return "name must be a string";
    if (name.trim().length === 0) return "name is required";
    if (name.length > PLACE_NAME_MAX_LENGTH)
      return `name must be at most ${PLACE_NAME_MAX_LENGTH} characters`;
  }

  if (altNames !== undefined && altNames !== null) {
    if (!Array.isArray(altNames)) return "altNames must be an array of strings";
    if (altNames.length > PLACE_MAX_ALT_NAMES)
      return `altNames must have at most ${PLACE_MAX_ALT_NAMES} entries`;
    for (const alt of altNames) {
      if (typeof alt !== "string")
        return "altNames must be an array of strings";
      if (alt.length > PLACE_NAME_MAX_LENGTH)
        return `altNames entries must be at most ${PLACE_NAME_MAX_LENGTH} characters`;
    }
  }

  // notes is deliberately uncapped in length (trip beta can be long); the 1 MB
  // body cap is its ceiling. Only the type matters for the 500-vs-400 bug.
  if (notes !== undefined && notes !== null && typeof notes !== "string")
    return "notes must be a string or null";

  if (attributes !== undefined && attributes !== null) {
    if (typeof attributes !== "object" || Array.isArray(attributes))
      return "attributes must be an object";
  }

  return null;
}

const router = Router();

// Hard cap on list responses. The body stays a bare array (consumers depend on
// that shape); when the result hits the cap the true owner-filtered total is
// surfaced via the X-Total-Count header so the UI can show "Showing N of TOTAL"
// without a response-shape change (UX-001).
const LIST_TAKE = 500;

// Which list a fetch is serving. This is an ACCESS decision, not a formatting
// one — see placeListInclude.
export type PlaceListScope = "owned" | "shared";

// Per-place `_count` is OWNER-PRIVATE and rides the OWNED list only.
//
// Under the hybrid share model a recipient sees the place RECORD (plus
// place-level notes/media); the trip-log list is owner-private. `tripLogLinks`
// is precisely that list's cardinality, and `shares` is the owner's share
// fan-out — how many other people they showed the place to. Neither is part of
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
export function placeListInclude(
  scope: PlaceListScope,
): Prisma.PlaceInclude | undefined {
  if (scope === "shared") return undefined;
  return { _count: { select: { tripLogLinks: true, shares: true } } };
}

async function fetchPlaces(
  where: Prisma.PlaceWhereInput,
  scope: PlaceListScope,
) {
  return prisma.place.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: LIST_TAKE,
    include: placeListInclude(scope),
  });
}

// GET /places — owned places
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const where = { ownerId: user.id };
    const [rows, total] = await Promise.all([
      fetchPlaces(where, "owned"),
      prisma.place.count({ where }),
    ]);
    res.set("X-Total-Count", String(total));
    res.json(rows);
  },
);

// GET /places/shared — places shared with me.
// Scope "shared" drops the owner-private `_count` (trip tally + share fan-out)
// — see placeListInclude.
router.get(
  "/shared",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const where = { shares: { some: { sharedWithId: user.id } } };
    const [rows, total] = await Promise.all([
      fetchPlaces(where, "shared"),
      prisma.place.count({ where }),
    ]);
    res.set("X-Total-Count", String(total));
    res.json(rows);
  },
);

// GET /places/tracks — track (GPX/KML) media for every place the user can
// access (owned + shared), for the map track layer. Derived purely from the
// user's own access set, so it never accepts an arbitrary id and preserves the
// 404-not-403 anti-oracle: a place the user can't see is simply absent.
// Returns minimal projection (no coords/names) — only the presigned track URL
// and its colour.
router.get(
  "/tracks",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const accessible = await prisma.place.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          { shares: { some: { sharedWithId: user.id } } },
        ],
      },
      select: { id: true },
    });
    const placeIds = accessible.map((place) => place.id);
    if (placeIds.length === 0) {
      res.json([]);
      return;
    }
    const rows = await prisma.media.findMany({
      where: {
        linkedType: "place",
        linkedId: { in: placeIds },
        mediaType: { in: TRACK_MIME_TYPES as unknown as string[] },
      },
      orderBy: { createdAt: "asc" },
    });
    const items = await toMediaItems(rows);
    res.json(
      items.map((item) => ({
        placeId: item.linkedId,
        mediaId: item.id,
        color: item.color,
        displayUrl: item.displayUrl,
      })),
    );
  },
);

// ── POST /places ─────────────────────────────────────────────
// Creates a new place
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

    // Validate coordinate + numeric-field ranges (PLACE-1/PLACE-2). Same
    // ranges as the CSV bulk-import path, sourced from @logjam/shared.
    const validationError =
      validatePlacePayload(req.body, { requireCoords: true }) ??
      validatePlaceTextFields(req.body);
    if (validationError) throw new AppError(400, validationError);

    // Optional client-minted id (Stage 8 §3.5): own-id replay → 200 with the
    // existing row; foreign id → 404 (see lib/clientSuppliedId.ts).
    const clientId = parseClientSuppliedId(req.body.id);
    if (clientId) {
      const existing = await prisma.place.findUnique({
        where: { id: clientId },
      });
      if (existing) {
        assertClientIdReplayable(existing.ownerId, user.id, "Place not found");
        res.status(200).json(existing);
        return;
      }
    }

    let place;
    try {
      place = await prisma.place.create({
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
        const winner = await prisma.place.findUnique({ where: { id: clientId } });
        if (winner && winner.ownerId === user.id) {
          res.status(200).json(winner);
          return;
        }
      }
      throw err;
    }

    res.status(201).json(place);
  },
);

// ── POST /places/:id/copy ─────────────────────────────────────────────
// Copies a shared place
router.post(
  "/:id/copy",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const placeId = getParam(req.params.id);
    const place = await prisma.place.findUnique({ where: { id: placeId } });
    if (!place) throw new AppError(404, "Place not found");

    // Owner and share recipients may copy (hybrid model: the place record
    // itself is visible to sharees).
    await requirePlaceAccess(user.id, place);

    // Create a copy of the place.
    // Drop ropeWikiId + ropeWikiSnapshot: @@unique([ownerId, ropeWikiId]) would
    // collide on self-copy, and preserving across owners would mis-attribute the
    // copy as the recipient's canonical RopeWiki record. Lineage is preserved
    // via forkedFromId; "forked from RopeWiki" is derivable from
    // forkedFrom.ropeWikiId if ever needed.
    const copiedPlace = await prisma.place.create({
      data: {
        ownerId: user.id,
        name: place.name,
        altNames: place.altNames,
        latitude: place.latitude,
        longitude: place.longitude,
        numAbseils: place.numAbseils,
        longestAbseil: place.longestAbseil,
        vGrade: place.vGrade,
        aGrade: place.aGrade,
        commitment: place.commitment,
        quality: place.quality,
        hours: place.hours,
        notes: place.notes,
        attributes: place.attributes ?? Prisma.JsonNull,
        ropeWikiId: null,
        ropeWikiSnapshot: Prisma.JsonNull,
        forkedFromId: placeId,
      },
    });

    // The linked route is copied with the place — deliberately UNLIKE media,
    // which a copy does not duplicate. A route is one row the copier now owns;
    // media is S3 objects plus a quota charge. The route is also the single
    // most useful thing to receive with a copied place, and the copier can
    // already see it (a linked route is part of the shared place record).
    const sourceRoute = await prisma.route.findUnique({
      where: { placeId },
      select: { name: true, color: true, points: true },
    });
    if (sourceRoute) {
      await prisma.route.create({
        data: {
          ownerId: user.id,
          placeId: copiedPlace.id,
          name: sourceRoute.name,
          color: sourceRoute.color,
          points: sourceRoute.points as Prisma.InputJsonValue,
        },
      });
    }

    res.status(201).json(copiedPlace);
  },
);

// ── GET /places/:id ──────────────────────────────────────────
// Returns a single place. Owners receive trip logs + all media.
// Share recipients receive place record + place-level media only
// (trip logs and trip media are owner-private — hybrid sharing model).
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const placeId = getParam(req.params.id);

    // Fetch owner first so we can decide includes before the full query.
    const stub = await prisma.place.findUnique({
      where: { id: placeId },
      select: { ownerId: true },
    });
    if (!stub) throw new AppError(404, "Place not found");

    const role = await requirePlaceAccess(user.id, {
      id: placeId,
      ownerId: stub.ownerId,
    });
    const isOwner = role === "owner";

    // Media is polymorphic with no FK relation, so it's fetched by
    // (linkedType, linkedId) and presigned here. Owners also get trip logs and
    // their media; share recipients receive place-level media only.
    if (isOwner) {
      const place = await prisma.place.findUnique({ where: { id: placeId } });
      if (!place) throw new AppError(404, "Place not found");

      // Join-based lookup (Place no longer has a direct tripLogs relation —
      // trips link via TripLogPlace, possibly to several places). Mirrors
      // GET /places/:placeId/trips (routes/tripLogs.ts).
      const trips = await prisma.tripLog.findMany({
        where: { userId: user.id, places: { some: { placeId } } },
        orderBy: { date: "desc" },
        include: tripPlacesInclude,
      });

      const tripIds = trips.map((trip) => trip.id);
      const [placeMedia, tripMediaRows] = await Promise.all([
        prisma.media.findMany({
          where: { linkedType: "place", linkedId: placeId },
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
      res.json({ ...place, media: await toMediaItems(placeMedia), tripLogs });
      return;
    }

    const place = await prisma.place.findUnique({ where: { id: placeId } });
    if (!place) throw new AppError(404, "Place not found");
    const placeMedia = await prisma.media.findMany({
      where: { linkedType: "place", linkedId: placeId },
      orderBy: { createdAt: "asc" },
    });
    res.json({ ...place, media: await toMediaItems(placeMedia) });
  },
);

// ── PATCH /places/:id ────────────────────────────────────────
// Updates an existing place (owner only)
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const place = await prisma.place.findUnique({
      where: { id: getParam(req.params.id) },
    });

    if (!place) throw new AppError(404, "Place not found");
    await requirePlaceOwnerAccess(
      user.id,
      place,
      "Only the owner can edit a place",
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

    // Validate any supplied coordinate/numeric field (PLACE-1/PLACE-2).
    // requireCoords:false — PATCH may omit fields; only validate what's present.
    const validationError =
      validatePlacePayload(req.body, { requireCoords: false }) ??
      validatePlaceTextFields(req.body);
    if (validationError) throw new AppError(400, validationError);

    const updated = await prisma.place.update({
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

// ── DELETE /places/:id ───────────────────────────────────────
// Deletes a place and all associated data (owner only)
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const place = await prisma.place.findUnique({
      where: { id: getParam(req.params.id) },
    });

    if (!place) throw new AppError(404, "Place not found");
    await requirePlaceOwnerAccess(
      user.id,
      place,
      "Only the owner can delete a place",
    );

    const id = getParam(req.params.id);

    const placeMediaRows = await prisma.media.findMany({
      where: { linkedType: "place", linkedId: id },
      select: {
        id: true,
        origin: true,
        s3KeyDisplay: true,
        s3KeyThumbnail: true,
        fileSizeBytes: true,
      },
    });
    // A standalone file linked as this place's way (an import, a recorded
    // track) is UNLINKED, never deleted — it is the user's own file and lives
    // on in Saved. Only the place's own attachments die with it. Same rule the
    // linked route already follows; lib/mediaLink.ts owns the decision.
    const { deleted: media, unlinked: unlinkedMedia } =
      partitionPlaceMedia(placeMediaRows);

    // S3-first (ARCH-004): the media S3 keys are already captured above, so
    // delete the blobs before the DB rows. deleteS3Keys throws on failure
    // (CH-002), aborting before any row is removed — no orphaned blobs, and the
    // DB still holds the place/media if a retry is needed.
    const s3Keys = media.flatMap((m) =>
      [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
    );
    const totalBytes = media.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0n), 0n);
    await deleteS3Keys(MEDIA_BUCKET, s3Keys);

    // Trip logs DETACH on place delete (the TripLogPlace join row cascades
    // away, not the trip), so a user removing a place keeps their personal
    // logbook entries and their per-trip media. Place shares and any other
    // place-linked children still FK-cascade; place-level media has no DB FK
    // on its polymorphic linkedId, so its deleteMany stays explicit. The quota
    // decrement shares the transaction (ARCH-004) so a crash after the row
    // deletes can't leave the quota over-counted (only place media frees
    // quota now — per-trip media survives with its trip).
    await prisma.$transaction(async (tx) => {
      await tx.media.deleteMany({
        where: { id: { in: media.map((m) => m.id) } },
      });
      await unlinkStandaloneMedia(
        tx,
        unlinkedMedia.map((m) => m.id),
      );
      // Preserve the (about-to-be-deleted) place's name on trips for which
      // this was their ONLY linked place, so they still carry a label once
      // the join row cascades away. Trips that keep another linked place
      // need no backfill (their title still derives from the survivor). Only
      // fill blanks so an explicit trip displayName is never overwritten.
      // Queried before place.delete below, while the join row still exists.
      const soleLinkTrips = await tx.tripLog.findMany({
        where: { displayName: null, places: { some: { placeId: id } } },
        select: { id: true, _count: { select: { places: true } } },
      });
      const orphanedTripIds = soleLinkTrips
        .filter((trip) => trip._count.places === 1)
        .map((trip) => trip.id);
      if (orphanedTripIds.length > 0) {
        await tx.tripLog.updateMany({
          where: { id: { in: orphanedTripIds } },
          data: { displayName: place.name },
        });
      }
      // Queried before the deleteMany below, while the share rows still exist:
      // each sharee must be told to forget the place + its place-level media
      // (sync tombstone fan-out — same transaction as the delete).
      const shares = await tx.placeShare.findMany({
        where: { placeId: id },
        select: { id: true, sharedWithId: true },
      });
      // The linked route (if any) SURVIVES this delete — Route.placeId is
      // SetNull, so it becomes standalone and the owner keeps it. Only the
      // sharees lose sight of it, which needs a tombstone each.
      const linkedRoute = await tx.route.findUnique({
        where: { placeId: id },
        select: { id: true },
      });
      // Linked WAYPOINTS survive too (PlaceWaypoint cascades the link, not the
      // waypoint), so this is the same revocation-without-a-delete as the route
      // above — except the link is many-to-many, so which sharees actually lose
      // sight of one can only be answered by diffing across the delete.
      const waypointVisibility = await snapshotPlaceWaypointVisibility(tx, id);
      await writeTombstones(
        tx,
        placeDeleteTombstones({
          ownerId: user.id,
          placeId: id,
          mediaIds: media.map((m) => m.id),
          shares,
          routeId: linkedRoute?.id ?? null,
          unlinkedMediaIds: unlinkedMedia.map((m) => m.id),
        }),
      );
      await tx.placeShare.deleteMany({ where: { placeId: id } });
      // Purge place_shared notifications held by OTHER users (the share
      // recipients) that reference this place — not just the owner's own rows
      // (PRIV-003). The read-time filter would hide them, but deletion removes
      // the residual record at rest.
      await tx.notification.deleteMany({
        where: {
          type: "place_shared",
          payload: { path: ["placeId"], equals: id },
        },
      });
      await tx.place.delete({ where: { id } });
      // After the delete: the link rows are gone, so this now sees the world as
      // the sharees will.
      await writeWaypointVisibilityLoss(tx, waypointVisibility);
      await decrementStorageUsed(user.id, totalBytes, tx);
    });

    res.status(204).send();
  },
);

export default router;
