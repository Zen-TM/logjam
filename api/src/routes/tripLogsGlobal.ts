import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";
import {
  enforceCanyoningTag,
  MAX_CANYONS_PER_TRIP,
  MAX_TRIP_TYPES_PER_TRIP,
  TRIP_NAME_MAX_LENGTH,
  TRIP_TYPE_MAX_LENGTH,
} from "@logjam/shared";
import { getParam } from "../lib/getParam";
import { getEnv } from "../lib/env";
import { deleteS3Keys } from "../lib/s3Cleanup";
import { decrementStorageUsed } from "../lib/storageQuota";
import { toMediaItems } from "../lib/mediaPresign";
import { resolveUser } from "../lib/resolveUser";
import { tripDeleteTombstones, writeTombstones } from "../lib/syncTombstones";
import {
  assertClientIdReplayable,
  parseClientSuppliedId,
} from "../lib/clientSuppliedId";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

const router = Router();

// Join rows are always fetched ordered by position; the derived trip title
// joins the names in this order.
export const tripCanyonsInclude = {
  canyons: {
    orderBy: { position: "asc" },
    select: { canyon: { select: { id: true, name: true } } },
  },
} satisfies Prisma.TripLogInclude;

type TripWithCanyons = Prisma.TripLogGetPayload<{
  include: typeof tripCanyonsInclude;
}>;

// Flattens the join rows into the API shape: canyons: [{ id, name }, …].
export function serializeTrip(trip: TripWithCanyons) {
  const { canyons, ...rest } = trip;
  return { ...rest, canyons: canyons.map((link) => link.canyon) };
}

// Validates that every supplied canyonId exists and is owned by the current
// user. Returns the ordered id list to persist ([] when unassigned). The
// error never echoes which ids failed — that would confirm foreign canyon
// ids exist (SEC-001 anti-oracle).
export async function resolveTripCanyonIds(
  userId: string,
  canyonIds: unknown,
): Promise<string[]> {
  if (canyonIds === undefined || canyonIds === null) return [];
  if (
    !Array.isArray(canyonIds) ||
    canyonIds.some((id) => typeof id !== "string")
  ) {
    throw new AppError(400, "canyonIds must be an array of strings");
  }
  if (canyonIds.length === 0) return [];
  if (canyonIds.length > MAX_CANYONS_PER_TRIP)
    throw new AppError(400, `At most ${MAX_CANYONS_PER_TRIP} canyons per trip`);
  if (new Set(canyonIds).size !== canyonIds.length)
    throw new AppError(400, "canyonIds contains duplicates");

  const owned = await prisma.canyon.count({
    where: { id: { in: canyonIds }, ownerId: userId },
  });
  if (owned !== canyonIds.length)
    throw new AppError(400, "One or more canyons were not found");
  return canyonIds;
}

// Normalizes an optional free-text trip-type list: an array of strings, each
// trimmed and nonempty, deduped case-insensitively, order preserved, capped.
// undefined → undefined (PATCH: leave unchanged); null → [] (clears the list).
export function parseTripTypes(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value))
    throw new AppError(400, "types must be an array of strings or null");

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string")
      throw new AppError(400, "types must be an array of strings");
    const trimmed = item.trim();
    if (trimmed.length === 0)
      throw new AppError(400, "types entries must not be empty");
    if (trimmed.length > TRIP_TYPE_MAX_LENGTH)
      throw new AppError(
        400,
        `types entries must be at most ${TRIP_TYPE_MAX_LENGTH} characters`,
      );
    const key = trimmed.toLowerCase();
    if (seen.has(key))
      throw new AppError(400, "types contains case-insensitive duplicates");
    seen.add(key);
    result.push(trimmed);
  }
  if (result.length > MAX_TRIP_TYPES_PER_TRIP)
    throw new AppError(
      400,
      `At most ${MAX_TRIP_TYPES_PER_TRIP} types per trip`,
    );
  return result;
}

// Resolves the `types` array a PATCH should persist, enforcing the canyoning
// tag across all four combinations of its two independently-optional fields.
//
//   types | canyonIds | tag decided from
//   ------+-----------+---------------------------------------------------
//   set   | set       | incoming types, incoming link state
//   set   | absent    | incoming types, STORED link state  ← the trap: without
//         |           |   the stored links, `types: []` on a canyon-linked
//         |           |   trip silently strips the tag
//   absent| set       | stored types, incoming link state (linking a canyon
//         |           |   to an untagged trip tags it)
//   absent| absent    | stored types, stored link state (no-op unless the trip
//         |           |   predates enforcement, which this write then repairs)
//
// `changed` is false when nothing needs writing, so a PATCH that never mentions
// `types` doesn't rewrite the column for nothing.
export function resolvePatchedTripTypes(args: {
  parsedTypes: string[] | undefined;
  storedTypes: string[];
  resolvedCanyonIds: string[] | undefined;
  storedHasLinkedCanyon: boolean;
}): { types: string[]; changed: boolean } {
  const { parsedTypes, storedTypes, resolvedCanyonIds, storedHasLinkedCanyon } =
    args;
  const hasLinkedCanyon =
    resolvedCanyonIds !== undefined
      ? resolvedCanyonIds.length > 0
      : storedHasLinkedCanyon;
  const types = enforceCanyoningTag(parsedTypes ?? storedTypes, hasLinkedCanyon);
  // enforceCanyoningTag only ever appends, so against the stored array a length
  // change is the only way it can differ.
  const changed =
    parsedTypes !== undefined || types.length !== storedTypes.length;
  return { types, changed };
}

// Normalizes an optional trip display name: trimmed, empty → null.
// Returns undefined when the field was absent (PATCH: leave unchanged).
function parseDisplayName(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string")
    throw new AppError(400, "displayName must be a string or null");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > TRIP_NAME_MAX_LENGTH)
    throw new AppError(
      400,
      `displayName must be at most ${TRIP_NAME_MAX_LENGTH} characters`,
    );
  return trimmed;
}

// ── GET /trips ────────────────────────────────────────────────
// Returns all trip logs owned by the current user.
// Query params: ?search= (trip name or linked canyon name), ?dateFrom=, ?dateTo=
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
              {
                canyons: {
                  some: {
                    canyon: {
                      name: { contains: search, mode: "insensitive" },
                    },
                  },
                },
              },
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
        include: tripCanyonsInclude,
      }),
      prisma.tripLog.count({ where }),
    ]);

    res.set("X-Total-Count", String(total));
    res.json(trips.map(serializeTrip));
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
      include: tripCanyonsInclude,
    });
    // Owner-private resource — 404 (not 403) for non-owners so the response
    // is no existence oracle for trip IDs (SEC-001).
    if (!trip || trip.userId !== user.id)
      throw new AppError(404, "Trip log not found");

    const mediaRows = await prisma.media.findMany({
      where: { linkedType: "tripLog", linkedId: id },
      orderBy: { createdAt: "asc" },
    });
    res.json({ ...serializeTrip(trip), media: await toMediaItems(mediaRows) });
  },
);

// ── POST /trips ───────────────────────────────────────────────
// Creates a trip log, optionally linked to any number of owned canyons
// (canyonIds omitted or [] = unassigned). displayName and types are
// independent optional fields; a bare trip needs only a date. The default
// title (joined canyon names) is derived at render time, never stored.
// A canyon-linked trip is force-tagged `canyoning` (enforceCanyoningTag).
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const { date, notes, customFields, canyonIds, displayName, types } =
      req.body;
    if (!date) throw new AppError(400, "date is required");

    const resolvedCanyonIds = await resolveTripCanyonIds(user.id, canyonIds);
    const trimmedDisplayName = parseDisplayName(displayName) ?? null;
    const parsedTypes = enforceCanyoningTag(
      parseTripTypes(types) ?? [],
      resolvedCanyonIds.length > 0,
    );

    // Optional client-minted id (Stage 8 §3.5): own-id replay → 200 with the
    // existing row; foreign id → 404 (see lib/clientSuppliedId.ts).
    const clientId = parseClientSuppliedId(req.body.id);
    if (clientId) {
      const existing = await prisma.tripLog.findUnique({
        where: { id: clientId },
        include: tripCanyonsInclude,
      });
      if (existing) {
        assertClientIdReplayable(existing.userId, user.id, "Trip log not found");
        res.status(200).json(serializeTrip(existing));
        return;
      }
    }

    let trip;
    try {
      trip = await prisma.tripLog.create({
        data: {
          ...(clientId && { id: clientId }),
          userId: user.id,
          date: new Date(date),
          displayName: trimmedDisplayName,
          types: parsedTypes,
          notes,
          customFields: customFields ?? {},
          canyons: {
            create: resolvedCanyonIds.map((canyonId, position) => ({
              canyonId,
              position,
            })),
          },
        },
        include: tripCanyonsInclude,
      });
    } catch (err) {
      // Concurrent replay of the same client id — return the winner's row,
      // mirroring media-confirm.
      if (
        clientId &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const winner = await prisma.tripLog.findUnique({
          where: { id: clientId },
          include: tripCanyonsInclude,
        });
        if (winner && winner.userId === user.id) {
          res.status(200).json(serializeTrip(winner));
          return;
        }
      }
      throw err;
    }

    res.status(201).json(serializeTrip(trip));
  },
);

// ── PATCH /trips/:id ──────────────────────────────────────────
// Updates a trip log. canyonIds, when present, replaces the full linked set
// (order included). displayName accepts explicit null to clear; types
// accepts explicit null or [] to clear (types: [] and null both mean "no
// types"); either replaces the full array when present.
//
// The `canyoning` tag is enforced on every PATCH, not just those that mention
// `types` — see the four-combination note below.
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const id = getParam(req.params.id);
    const trip = await prisma.tripLog.findUnique({
      where: { id },
      // The canyon links are fetched, not just the row: `canyonIds` and `types`
      // are independently optional, so enforcement needs the trip's CURRENT
      // link state whenever the request omits canyonIds. Without this, a PATCH
      // of `types: []` on a canyon-linked trip would silently strip the tag.
      // take: 1 — only existence is needed, never the ids.
      include: { canyons: { select: { canyonId: true }, take: 1 } },
    });
    // Owner-private resource — 404 (not 403) for non-owners (SEC-001).
    if (!trip || trip.userId !== user.id)
      throw new AppError(404, "Trip log not found");

    const { date, notes, customFields, canyonIds, displayName, types } =
      req.body;

    const resolvedCanyonIds =
      canyonIds !== undefined
        ? await resolveTripCanyonIds(user.id, canyonIds)
        : undefined;
    const trimmedDisplayName = parseDisplayName(displayName);
    const parsedTypes = parseTripTypes(types);

    // "A canyon-linked trip carries the canyoning tag" is maintained on every
    // write, not only on writes that mention `types` — see the helper.
    const { types: effectiveTypes, changed: typesChanged } =
      resolvePatchedTripTypes({
        parsedTypes,
        storedTypes: trip.types,
        resolvedCanyonIds,
        storedHasLinkedCanyon: trip.canyons.length > 0,
      });

    const updated = await prisma.tripLog.update({
      where: { id },
      data: {
        ...(date !== undefined && { date: new Date(date) }),
        ...(notes !== undefined && { notes }),
        ...(customFields !== undefined && {
          customFields: customFields ?? Prisma.JsonNull,
        }),
        ...(trimmedDisplayName !== undefined && {
          displayName: trimmedDisplayName,
        }),
        ...(typesChanged && { types: effectiveTypes }),
        ...(resolvedCanyonIds !== undefined && {
          canyons: {
            deleteMany: {},
            create: resolvedCanyonIds.map((canyonId, position) => ({
              canyonId,
              position,
            })),
          },
          // Force-touch the watermark: a canyonIds-only PATCH writes only
          // nested TripLogCanyon rows, and Prisma's @updatedAt is not
          // guaranteed to bump the parent for nested-only writes. A trip whose
          // links changed MUST move past the delta cursor (stage8 §3.1 trap).
          updatedAt: new Date(),
        }),
      },
      include: tripCanyonsInclude,
    });

    res.json(serializeTrip(updated));
  },
);

// ── DELETE /trips/:id ─────────────────────────────────────────
// Deletes a trip log and its media (owner-only). Join rows cascade away.
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
      select: {
        id: true,
        s3KeyDisplay: true,
        s3KeyThumbnail: true,
        fileSizeBytes: true,
      },
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
      // Same transaction as the delete (sync tombstone rule — see
      // lib/syncTombstones.ts).
      await writeTombstones(
        tx,
        tripDeleteTombstones({
          ownerId: user.id,
          tripId: id,
          mediaIds: media.map((m) => m.id),
        }),
      );
    });

    res.status(204).send();
  },
);

export default router;
