// Stage 8 delta sync — the mobile mirror's read path (stage8-sync.md §4).
//
// PRIVACY INVARIANTS (§4.6, test-enforced by __tests__/syncBoundary.test.ts):
// 1. No request parameter ever names an entity — everything derives from the
//    caller's own visibility set, so the endpoint cannot be an oracle for
//    foreign ids at all (stronger than 404-not-403: no id slot to probe).
// 2. A sharee's delta never contains trip logs, trip media, or co-sharee
//    rows; user joins are username-only (never email).
// 3. Unshare and canyon-delete emit the SAME sharee signal (a `canyon`
//    tombstone) — deliberately indistinguishable.
// 4. Logging: counts and cursor timestamps only — never row contents.
import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getEnv } from "../lib/env";
import { logger } from "../lib/logger";
import { resolveUser } from "../lib/resolveUser";
import {
  decodeSyncCursor,
  encodeSyncCursor,
  SYNC_DELTA_DEFAULT_LIMIT,
  SYNC_DELTA_MAX_LIMIT,
  SYNC_OVERLAP_MS,
  SYNC_PROTOCOL,
  type SyncCursor,
  type SyncCursorKeysets,
} from "@logjam/shared";
import { serializeTrip, tripCanyonsInclude } from "./tripLogsGlobal";

const router = Router();

// `mobile/<semver>`-style client identification, required on /sync/* (§10.1)
// so stale-fleet composition is observable before any breaking change. The
// version string is the ONLY thing logged — never user data.
const CLIENT_HEADER_REGEX = /^[a-z]+\/[0-9A-Za-z.\-+]+$/;

export function requireClientHeader(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const value = req.header("x-logjam-client");
  if (!value || !CLIENT_HEADER_REGEX.test(value)) {
    throw new AppError(400, "x-logjam-client header is required");
  }
  next();
}

/** Keyset resume point: [watermark ISO, last id]. */
type Keyset = [string, string];

// Builds the "changed since, resuming after" where-fragment for one entity.
// Keyset resume is (watermark, id) lexicographic: strictly-later watermark,
// or same watermark with a later id.
function keysetWhere(
  field: "updatedAt" | "createdAt",
  since: Date,
  after: Keyset | undefined,
): Record<string, unknown> {
  if (after) {
    const [afterTs, afterId] = after;
    return {
      OR: [
        { [field]: { gt: new Date(afterTs) } },
        { [field]: new Date(afterTs), id: { gt: afterId } },
      ],
    };
  }
  return { [field]: { gt: since } };
}

// GET /sync/delta?cursor=<opaque>&limit=<1..1000>
router.get(
  "/delta",
  requireAuth,
  requireClientHeader,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const env = getEnv();
    const serverTime = new Date();

    const limitRaw = req.query.limit;
    let limit = SYNC_DELTA_DEFAULT_LIMIT;
    if (limitRaw !== undefined) {
      limit = Number(limitRaw);
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > SYNC_DELTA_MAX_LIMIT
      ) {
        throw new AppError(400, `limit must be 1..${SYNC_DELTA_MAX_LIMIT}`);
      }
    }

    // Cursor: absent/empty = initial full sync (everything changed since the
    // epoch start). Anything malformed, from another protocol version or
    // epoch, or older than the tombstone horizon → resetRequired (§4.3): the
    // client wipes its MIRROR (never the outbox) and re-pulls from "".
    const cursorParam =
      typeof req.query.cursor === "string" ? req.query.cursor : "";
    let cursor: SyncCursor;
    let resetRequired = false;
    if (cursorParam === "") {
      cursor = { v: SYNC_PROTOCOL, ts: new Date(0).toISOString() };
    } else {
      const decoded = decodeSyncCursor(cursorParam);
      if (!decoded) {
        resetRequired = true;
        cursor = { v: SYNC_PROTOCOL, ts: new Date(0).toISOString() };
      } else {
        cursor = decoded;
        const cursorTs = Date.parse(decoded.ts);
        // ts === 0 is the initial-sync watermark the server itself mints for
        // intermediate pages of a first pull — exempt from the horizon check
        // or a paged initial sync could never finish. A tampered ts=0 cursor
        // only re-downloads the caller's own rows (§4.2: unsigned by design).
        const pastTombstoneHorizon =
          env.SYNC_TOMBSTONE_TTL_MS > 0 &&
          cursorTs !== 0 &&
          cursorTs < serverTime.getTime() - env.SYNC_TOMBSTONE_TTL_MS;
        if (
          decoded.v !== SYNC_PROTOCOL ||
          (decoded.e ?? 1) !== env.SYNC_EPOCH ||
          pastTombstoneHorizon
        ) {
          resetRequired = true;
        }
      }
    }

    if (resetRequired) {
      logger.info(
        { userId: user.id, reason: "reset_required" },
        "sync_delta_reset",
      );
      res.json({
        protocol: SYNC_PROTOCOL,
        epoch: env.SYNC_EPOCH,
        serverTime: serverTime.toISOString(),
        cursor: "",
        hasMore: false,
        resetRequired: true,
        changes: {
          canyons: [],
          tripLogs: [],
          waypoints: [],
          media: [],
          canyonShares: [],
          friendships: [],
        },
        tombstones: [],
      });
      return;
    }

    const since = new Date(cursor.ts);
    const keysets: SyncCursorKeysets = cursor.k ?? {};
    const nextKeysets: SyncCursorKeysets = {};
    let remaining = limit;
    let hasMore = false;

    // Visibility sets, computed ONCE per request (§4.5). Never an id from the
    // request.
    const sharedCanyonRows = await prisma.canyonShare.findMany({
      where: { sharedWithId: user.id },
      select: { canyonId: true },
    });
    const sharedCanyonIds = sharedCanyonRows.map((row) => row.canyonId);

    // Generic budget-fill step: fetch up to remaining+1 rows for one entity,
    // truncate, record the keyset when the entity didn't drain. Entities run
    // in the fixed §4.4 order; once the budget is spent (hasMore), later
    // entities are skipped entirely and resume from their absent keyset on
    // the next page.
    async function fill<Row extends { id: string }>(
      key: keyof SyncCursorKeysets,
      fetch: (after: Keyset | undefined, take: number) => Promise<Row[]>,
      // Declared AFTER fetch so Row infers from the Prisma return type — with
      // this context-sensitive lambda first, inference collapses Row to the
      // constraint and loses every column.
      watermarkOf: (row: Row) => Date,
    ): Promise<Row[]> {
      if (hasMore || remaining === 0) {
        // Budget already spent: preserve an existing resume point so the next
        // page continues where the cursor said, not from scratch.
        if (keysets[key]) nextKeysets[key] = keysets[key];
        hasMore = true;
        return [];
      }
      const rows = await fetch(keysets[key], remaining + 1);
      if (rows.length > remaining) {
        const page = rows.slice(0, remaining);
        const last = page[page.length - 1];
        nextKeysets[key] = [watermarkOf(last).toISOString(), last.id];
        hasMore = true;
        remaining = 0;
        return page;
      }
      // Entity drained. STILL record a resume point (last row delivered, or
      // the carried-over one): if a LATER entity truncates this page, the
      // next page must skip past what this page already delivered — without
      // this, re-delivered rows could consume the whole budget every page and
      // starve the entities behind them (client never finishes pagination).
      // The keyset dies with the final page anyway (cursor drops k).
      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        nextKeysets[key] = [watermarkOf(last).toISOString(), last.id];
      } else if (keysets[key]) {
        nextKeysets[key] = keysets[key];
      }
      remaining -= rows.length;
      return rows;
    }

    const canyons = await fill(
      "canyons",
      (after, take) =>
        prisma.canyon.findMany({
          where: {
            AND: [
              {
                OR: [
                  { ownerId: user.id },
                  { id: { in: sharedCanyonIds } },
                ],
              },
              keysetWhere("updatedAt", since, after),
            ],
          },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take,
        }),
      (row) => row.updatedAt,
    );

    const tripLogs = await fill(
      "tripLogs",
      (after, take) =>
        prisma.tripLog.findMany({
          where: {
            AND: [{ userId: user.id }, keysetWhere("updatedAt", since, after)],
          },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take,
          include: tripCanyonsInclude,
        }),
      (row) => row.updatedAt,
    );

    const waypoints = await fill(
      "waypoints",
      (after, take) =>
        prisma.waypoint.findMany({
          where: {
            AND: [{ ownerId: user.id }, keysetWhere("updatedAt", since, after)],
          },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take,
        }),
      (row) => row.updatedAt,
    );

    const media = await fill(
      "media",
      (after, take) =>
        prisma.media.findMany({
          where: {
            AND: [
              {
                // Own media, plus canyon-level media of canyons shared with
                // me — exactly what a sharee can already fetch via
                // GET /canyons/:id. Trip media of other owners can never
                // match (its linkedType is "tripLog").
                OR: [
                  { ownerId: user.id },
                  {
                    linkedType: "canyon",
                    linkedId: { in: sharedCanyonIds },
                  },
                ],
              },
              keysetWhere("createdAt", since, after),
            ],
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take,
        }),
      (row) => row.createdAt,
    );

    const canyonShares = await fill(
      "canyonShares",
      (after, take) =>
        prisma.canyonShare.findMany({
          where: {
            AND: [
              // Caller is sharer or sharee — a sharee can never enumerate
              // co-sharees (§4.6.1).
              { OR: [{ sharedById: user.id }, { sharedWithId: user.id }] },
              keysetWhere("createdAt", since, after),
            ],
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take,
          include: {
            // Username-only — email in a delta response is a regression.
            sharedBy: { select: { id: true, username: true } },
            sharedWith: { select: { id: true, username: true } },
          },
        }),
      (row) => row.createdAt,
    );

    const friendships = await fill<
      Prisma.FriendshipGetPayload<{
        include: {
          requester: { select: { id: true; username: true } };
          addressee: { select: { id: true; username: true } };
        };
      }>
    >(
      "friendships",
      (after, take) =>
        prisma.friendship.findMany({
          where: {
            AND: [
              { OR: [{ requesterId: user.id }, { addresseeId: user.id }] },
              keysetWhere("updatedAt", since, after),
            ],
          },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take,
          include: {
            requester: { select: { id: true, username: true } },
            addressee: { select: { id: true, username: true } },
          },
        }),
      (row) => row.updatedAt,
    );

    // Tombstones close the budget order. BigInt PK: the keyset id is the
    // stringified PK, compared as BigInt on resume.
    type TombstoneRow = {
      id: bigint;
      entityType: string;
      entityId: string;
      deletedAt: Date;
    };
    let tombstones: TombstoneRow[] = [];
    if (!hasMore && remaining === 0) {
      // Budget spent exactly at the entity boundary: whether tombstones are
      // pending is unknown, so the cursor must NOT advance — the next page
      // re-enters here with budget and delivers them.
      hasMore = true;
    }
    if (!hasMore && remaining > 0) {
      const after = keysets.tombstones;
      const rows = await prisma.syncTombstone.findMany({
        where: {
          AND: [
            { userId: user.id },
            after
              ? {
                  OR: [
                    { deletedAt: { gt: new Date(after[0]) } },
                    {
                      deletedAt: new Date(after[0]),
                      id: { gt: BigInt(after[1]) },
                    },
                  ],
                }
              : { deletedAt: { gt: since } },
          ],
        },
        orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
        take: remaining + 1,
      });
      if (rows.length > remaining) {
        tombstones = rows.slice(0, remaining);
        const last = tombstones[tombstones.length - 1];
        nextKeysets.tombstones = [last.deletedAt.toISOString(), String(last.id)];
        hasMore = true;
      } else {
        tombstones = rows;
      }
    } else if (keysets.tombstones) {
      nextKeysets.tombstones = keysets.tombstones;
      hasMore = true;
    }

    // Cursor advance rule (§4.4): ts moves (and keysets clear) only on the
    // final page; intermediate pages keep the old watermark + resume keysets.
    const nextCursor: SyncCursor = hasMore
      ? { v: SYNC_PROTOCOL, ts: cursor.ts, e: env.SYNC_EPOCH, k: nextKeysets }
      : {
          v: SYNC_PROTOCOL,
          ts: new Date(serverTime.getTime() - SYNC_OVERLAP_MS).toISOString(),
          e: env.SYNC_EPOCH,
        };

    // Counts + cursor timestamps only — never row contents (§4.6.5).
    logger.info(
      {
        userId: user.id,
        sinceTs: cursor.ts,
        hasMore,
        counts: {
          canyons: canyons.length,
          tripLogs: tripLogs.length,
          waypoints: waypoints.length,
          media: media.length,
          canyonShares: canyonShares.length,
          friendships: friendships.length,
          tombstones: tombstones.length,
        },
      },
      "sync_delta_served",
    );

    res.json({
      protocol: SYNC_PROTOCOL,
      epoch: env.SYNC_EPOCH,
      serverTime: serverTime.toISOString(),
      cursor: encodeSyncCursor(nextCursor),
      hasMore,
      resetRequired: false,
      changes: {
        canyons: canyons.map((canyon) => ({
          syncRole: canyon.ownerId === user.id ? "owner" : "shared",
          ...canyon,
        })),
        tripLogs: tripLogs.map(serializeTrip),
        waypoints,
        // Metadata only: no S3 keys, no presigned URLs (§7.3 — blobs are
        // fetched via POST /media/download-urls). BigInt → string.
        media: media.map((row) => ({
          id: row.id,
          linkedType: row.linkedType,
          linkedId: row.linkedId,
          mediaType: row.mediaType,
          filename: row.filename,
          fileSizeBytes: String(row.fileSizeBytes),
          color: row.color,
          createdAt: row.createdAt,
        })),
        canyonShares,
        friendships: friendships.map((f) => ({
          id: f.id,
          status: f.status,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
          counterpart: f.requesterId === user.id ? f.addressee : f.requester,
          direction: f.requesterId === user.id ? "sent" : "received",
        })),
      },
      tombstones: tombstones.map((t) => ({ type: t.entityType, id: t.entityId })),
    });
  },
);

export default router;
