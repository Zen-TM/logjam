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
  enforceCanyoningTag,
  isUuidV4,
  SYNC_DELTA_DEFAULT_LIMIT,
  SYNC_DELTA_MAX_LIMIT,
  SYNC_DELTA_ROUTE_LIMIT,
  SYNC_OVERLAP_MS,
  SYNC_PROTOCOL,
  SYNC_PUSH_MAX_OPS,
  SYNC_PUSH_OPS_BY_ENTITY,
  pushOpDependencies,
  validateCanyonPayload,
  validateRoutePayload,
  validateWaypointPayload,
  parseRoutePoints,
  randomTrackColor,
  type SyncCursor,
  type SyncCursorKeysets,
  type SyncPushOp,
} from "@logjam/shared";
import {
  parseDisplayName,
  parseTripTypes,
  resolvePatchedTripTypes,
  resolveTripCanyonIds,
  serializeTrip,
  tripCanyonsInclude,
} from "./tripLogsGlobal";
import { deleteCanyonsCascade, deleteTripsCascade } from "../lib/bulkDelete";
import {
  routeDeleteTombstones,
  waypointDeleteTombstones,
  writeTombstones,
} from "../lib/syncTombstones";
import {
  applyRouteCanyonLink,
  canyonShareeIds,
  parseAnchorsOrNull,
  resolveRouteCanyonId,
} from "../lib/routeLink";

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
          routes: [],
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
      // Optional per-entity row cap, tighter than the shared budget. Only
      // routes use it: they carry their whole geometry inline (up to
      // MAX_ROUTE_POINTS ≈ 20 KB each), so the default 500-row budget would
      // build a ~10 MB page. Hitting this cap sets hasMore like any other
      // truncation, so the rest arrives on the next page.
      maxRows?: number,
    ): Promise<Row[]> {
      const budget =
        maxRows === undefined ? remaining : Math.min(remaining, maxRows);
      if (hasMore || budget === 0) {
        // Budget already spent: preserve an existing resume point so the next
        // page continues where the cursor said, not from scratch.
        if (keysets[key]) nextKeysets[key] = keysets[key];
        hasMore = true;
        return [];
      }
      const rows = await fetch(keysets[key], budget + 1);
      if (rows.length > budget) {
        const page = rows.slice(0, budget);
        const last = page[page.length - 1];
        nextKeysets[key] = [watermarkOf(last).toISOString(), last.id];
        hasMore = true;
        // Equivalent to the old `remaining = 0` when no cap applies (page
        // length is then exactly `remaining`), and correct when one does.
        remaining -= page.length;
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

    // Owned routes, plus routes LINKED to a canyon shared with me — the same
    // visibility canyon-level media has (a linked route is part of the shared
    // canyon record). An unlinked route of another owner can never match.
    const routes = await fill(
      "routes",
      (after, take) =>
        prisma.route.findMany({
          where: {
            AND: [
              {
                OR: [
                  { ownerId: user.id },
                  { canyonId: { in: sharedCanyonIds } },
                ],
              },
              keysetWhere("updatedAt", since, after),
            ],
          },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take,
        }),
      (row) => row.updatedAt,
      SYNC_DELTA_ROUTE_LIMIT,
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
          routes: routes.length,
          media: media.length,
          canyonShares: canyonShares.length,
          friendships: friendships.length,
          tombstones: tombstones.length,
        },
      },
      "sync_delta_served",
    );

    // Ids delivered as live rows in this same page, by tombstone entityType.
    const liveIds = new Map<string, Set<string>>([
      ["canyon", new Set(canyons.map((row) => row.id))],
      ["tripLog", new Set(tripLogs.map((row) => row.id))],
      ["waypoint", new Set(waypoints.map((row) => row.id))],
      ["route", new Set(routes.map((row) => row.id))],
      ["media", new Set(media.map((row) => row.id))],
      ["canyonShare", new Set(canyonShares.map((row) => row.id))],
      ["friendship", new Set(friendships.map((row) => row.id))],
    ]);

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
        // Geometry travels INLINE (no blob leg). syncRole tells the client
        // whether this is its own route or one seen through a canyon share —
        // a 'shared' route is read-only there.
        routes: routes.map((route) => ({
          syncRole: route.ownerId === user.id ? "owner" : "shared",
          ...route,
        })),
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
      // A tombstone for a row that is ALSO in this page's changes is stale by
      // construction: the change was read from the live table, so the row
      // exists now. The client applies every upsert and then every tombstone,
      // with no per-item ordering, so shipping both meant the delete won —
      // unshare at 09:00, re-share at 09:05, edit at 09:06, and the 09:10
      // pull deleted the canyon, its cached media and its blobs. Same shape
      // for any delete-then-recreate under one id.
      tombstones: tombstones
        .filter((t) => !liveIds.get(t.entityType)?.has(t.entityId))
        .map((t) => ({ type: t.entityType, id: t.entityId })),
    });
  },
);

// ── POST /sync/push — the outbox write path (§8) ────────────────────────────
//
// Applies up to SYNC_PUSH_MAX_OPS ops strictly in array order, each in its
// own transaction: one bad op must not roll back applied predecessors — the
// client learns per-op outcomes and partial progress + resume is the normal
// case for flaky field connectivity. Validation is IDENTICAL to the REST
// routes (same exported helpers — divergence here is the SEC-001 failure
// mode). Media ops are NOT accepted (the three-phase presign flow owns them).
// Conflict rule (§6): arrival-order field-scoped LWW — `baseUpdatedAt` is
// used only to DETECT that a receipt is owed, never to resolve.

type PushOpResult = {
  opId: string;
  status:
    | "applied"
    | "appliedWithConflict"
    | "alreadyApplied"
    | "rejected"
    | "dependencyFailed";
  row?: unknown;
  conflicts?: { field: string; serverValue: unknown }[];
  error?: { code: number; message: string };
};

// Per-entity field whitelists. An unknown key is a per-op 400 (`rejected`),
// never silently dropped (§10.4) — the client parks the op visibly instead
// of losing a field a newer app version wrote.
const CANYON_FIELDS = new Set([
  "name",
  "altNames",
  "latitude",
  "longitude",
  "numAbseils",
  "longestAbseil",
  "vGrade",
  "aGrade",
  "commitment",
  "quality",
  "hours",
  "notes",
  "attributes",
]);
const TRIP_FIELDS = new Set([
  "date",
  "displayName",
  "types",
  "notes",
  "customFields",
  "canyonIds",
]);
const WAYPOINT_FIELDS = new Set([
  "name",
  "latitude",
  "longitude",
  "elevation",
  "symbol",
  "notes",
  "canyonId",
]);
// `color` is deliberately absent: it is assigned server-side from
// TRACK_COLORS at create, like track media.
const ROUTE_FIELDS = new Set(["name", "points", "anchors", "canyonId"]);

function assertKnownFields(
  fields: Record<string, unknown>,
  allowed: Set<string>,
): void {
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key)) {
      throw new AppError(400, `Unknown field: ${key}`);
    }
  }
}

// Field-scoped conflict receipts: the client's edit base predates the
// server row AND the server's current value differs from what the op writes
// → the write wins (arrival order) but the overwritten server value is
// returned for the client's conflict shelf. Same-value writes owe nothing.
//
// CONTRACT: the server has no per-field history, so it deliberately
// OVER-reports — a receipt means "this is the value your write replaced
// while your base was stale", not "the server changed this field". The
// client holds the base row, so it filters: a receipt whose serverValue
// equals the client's own base value is a self-conflict and is dropped
// before shelving (flush-engine rule, PR-5).
export function conflictReceipts(
  baseUpdatedAt: string | undefined,
  serverUpdatedAt: Date,
  incoming: Record<string, unknown>,
  current: Record<string, unknown>,
): { field: string; serverValue: unknown }[] {
  if (!baseUpdatedAt) return [];
  if (new Date(baseUpdatedAt).getTime() === serverUpdatedAt.getTime()) return [];
  const receipts: { field: string; serverValue: unknown }[] = [];
  for (const [field, value] of Object.entries(incoming)) {
    const serverValue = current[field];
    if (JSON.stringify(serverValue ?? null) !== JSON.stringify(value ?? null)) {
      receipts.push({ field, serverValue: serverValue ?? null });
    }
  }
  return receipts;
}

// Wire shape + entity/op vocabulary live in shared/src/sync.ts (§11: one
// protocol definition for api + mobile).
type PushOp = SyncPushOp;

const PUSH_OPS: Record<PushOp["entity"], Set<string>> = Object.fromEntries(
  Object.entries(SYNC_PUSH_OPS_BY_ENTITY).map(([entity, ops]) => [
    entity,
    new Set(ops),
  ]),
) as Record<PushOp["entity"], Set<string>>;

export function parsePushOp(raw: unknown, index: number): PushOp {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError(400, `ops[${index}] must be an object`);
  }
  const { opId, entity, op, id, baseUpdatedAt, fields } = raw as Record<
    string,
    unknown
  >;
  if (typeof opId !== "string" || opId.length === 0 || opId.length > 64) {
    throw new AppError(400, `ops[${index}].opId is required`);
  }
  if (typeof entity !== "string" || !(entity in PUSH_OPS)) {
    throw new AppError(400, `ops[${index}].entity is invalid`);
  }
  if (typeof op !== "string" || !PUSH_OPS[entity as PushOp["entity"]].has(op)) {
    throw new AppError(400, `ops[${index}].op is invalid for ${entity}`);
  }
  if (!isUuidV4(id)) {
    throw new AppError(400, `ops[${index}].id must be a UUIDv4`);
  }
  if (
    baseUpdatedAt !== undefined &&
    (typeof baseUpdatedAt !== "string" ||
      Number.isNaN(Date.parse(baseUpdatedAt)))
  ) {
    throw new AppError(400, `ops[${index}].baseUpdatedAt must be an ISO date`);
  }
  if (
    fields !== undefined &&
    (typeof fields !== "object" || fields === null || Array.isArray(fields))
  ) {
    throw new AppError(400, `ops[${index}].fields must be an object`);
  }
  return {
    opId,
    entity: entity as PushOp["entity"],
    op: op as PushOp["op"],
    id,
    ...(baseUpdatedAt !== undefined && { baseUpdatedAt }),
    ...(fields !== undefined && { fields: fields as Record<string, unknown> }),
  };
}

// Dependency extraction moved to shared (§11 single source — the client's
// flush engine runs the same closure). Re-exported so existing imports and
// the unit suite keep working.
export const opDependencies = pushOpDependencies;

/**
 * A trip's `date` is a DATE, stored as UTC midnight (CH-001) — `tripFilter`'s
 * whole-day comparisons depend on it. The push path accepted any parseable
 * string, so a client sending an instant stored a trip with a nonzero time
 * that its own day's `dateTo` filter then excluded. Normalize at the boundary
 * rather than trusting the client to.
 */
function tripDateFromPush(value: unknown): Date {
  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime())) throw new AppError(400, "date is invalid");
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
}

/**
 * A create op is replay-safe by "does this row exist?" — but a replay that
 * arrives AFTER the row was deleted found nothing and dutifully recreated it,
 * undoing the delete. (The gap is real: a push whose response is lost returns
 * the op to the client's queue, and the user can delete the row from the web
 * in the meantime.) A tombstone is the record that this id is meant to be
 * gone, so it stands in for the row that is no longer there to be found.
 */
async function createAlreadyTombstoned(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  const tombstone = await prisma.syncTombstone.findFirst({
    where: { userId, entityType, entityId },
    select: { id: true },
  });
  return tombstone !== null;
}

async function applyCanyonOp(userId: string, op: PushOp): Promise<PushOpResult> {
  if (op.op === "delete") {
    const deleted = await deleteCanyonsCascade(userId, [op.id]);
    // Row already gone (or never visible): idempotent success — a delete's
    // goal state is "not there" (§8.1), and distinguishing foreign from
    // missing would be an oracle.
    return { opId: op.opId, status: deleted.length ? "applied" : "alreadyApplied" };
  }

  const fields = op.fields ?? {};
  assertKnownFields(fields, CANYON_FIELDS);
  const validationError = validateCanyonPayload(fields, {
    requireCoords: op.op === "create",
  });
  if (validationError) throw new AppError(400, validationError);

  if (op.op === "create") {
    if (!fields.name || fields.latitude === undefined || fields.longitude === undefined) {
      throw new AppError(400, "name, latitude, and longitude are required");
    }
    const existing = await prisma.canyon.findUnique({ where: { id: op.id } });
    if (existing) {
      if (existing.ownerId !== userId)
        throw new AppError(404, "Canyon not found");
      return { opId: op.opId, status: "alreadyApplied", row: existing };
    }
    if (await createAlreadyTombstoned(userId, "canyon", op.id)) {
      return { opId: op.opId, status: "alreadyApplied" };
    }
    const canyon = await prisma.canyon.create({
      data: {
        id: op.id,
        ownerId: userId,
        name: fields.name as string,
        altNames: (fields.altNames as string[] | undefined) ?? [],
        latitude: fields.latitude as number,
        longitude: fields.longitude as number,
        numAbseils: (fields.numAbseils as number | null | undefined) ?? null,
        longestAbseil: (fields.longestAbseil as number | null | undefined) ?? null,
        vGrade: (fields.vGrade as number | null | undefined) ?? null,
        aGrade: (fields.aGrade as number | null | undefined) ?? null,
        commitment: (fields.commitment as number | null | undefined) ?? null,
        quality: (fields.quality as number | null | undefined) ?? null,
        hours: (fields.hours as number | null | undefined) ?? null,
        notes: (fields.notes as string | null | undefined) ?? null,
        attributes: (fields.attributes ?? {}) as Prisma.InputJsonValue,
      },
    });
    return { opId: op.opId, status: "applied", row: canyon };
  }

  // update
  const canyon = await prisma.canyon.findUnique({ where: { id: op.id } });
  // Deleted-or-foreign → the same 404 the REST PATCH gives (client parks as
  // deadRemote; delete-wins per §6).
  if (!canyon || canyon.ownerId !== userId)
    throw new AppError(404, "Canyon not found");

  const conflicts = conflictReceipts(
    op.baseUpdatedAt,
    canyon.updatedAt,
    fields,
    canyon as unknown as Record<string, unknown>,
  );
  const updated = await prisma.canyon.update({
    where: { id: op.id },
    data: {
      ...(fields.name !== undefined && { name: fields.name as string }),
      ...(fields.altNames !== undefined && {
        altNames: fields.altNames as string[],
      }),
      ...(fields.latitude !== undefined && {
        latitude: fields.latitude as number,
      }),
      ...(fields.longitude !== undefined && {
        longitude: fields.longitude as number,
      }),
      ...(fields.numAbseils !== undefined && {
        numAbseils: fields.numAbseils as number | null,
      }),
      ...(fields.longestAbseil !== undefined && {
        longestAbseil: fields.longestAbseil as number | null,
      }),
      ...(fields.vGrade !== undefined && {
        vGrade: fields.vGrade as number | null,
      }),
      ...(fields.aGrade !== undefined && {
        aGrade: fields.aGrade as number | null,
      }),
      ...(fields.commitment !== undefined && {
        commitment: fields.commitment as number | null,
      }),
      ...(fields.quality !== undefined && {
        quality: fields.quality as number | null,
      }),
      ...(fields.hours !== undefined && { hours: fields.hours as number | null }),
      ...(fields.notes !== undefined && { notes: fields.notes as string | null }),
      ...(fields.attributes !== undefined && {
        attributes: (fields.attributes ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      }),
    },
  });
  return conflicts.length > 0
    ? { opId: op.opId, status: "appliedWithConflict", row: updated, conflicts }
    : { opId: op.opId, status: "applied", row: updated };
}

async function applyTripOp(userId: string, op: PushOp): Promise<PushOpResult> {
  if (op.op === "delete") {
    const deleted = await deleteTripsCascade(userId, [op.id]);
    return { opId: op.opId, status: deleted.length ? "applied" : "alreadyApplied" };
  }

  const fields = op.fields ?? {};
  assertKnownFields(fields, TRIP_FIELDS);

  if (op.op === "create") {
    if (!fields.date) throw new AppError(400, "date is required");
    const existing = await prisma.tripLog.findUnique({
      where: { id: op.id },
      include: tripCanyonsInclude,
    });
    if (existing) {
      if (existing.userId !== userId)
        throw new AppError(404, "Trip log not found");
      return {
        opId: op.opId,
        status: "alreadyApplied",
        row: serializeTrip(existing),
      };
    }
    if (await createAlreadyTombstoned(userId, "tripLog", op.id)) {
      return { opId: op.opId, status: "alreadyApplied" };
    }
    const resolvedCanyonIds = await resolveTripCanyonIds(
      userId,
      fields.canyonIds,
    );
    const trimmedDisplayName = parseDisplayName(fields.displayName) ?? null;
    const parsedTypes = enforceCanyoningTag(
      parseTripTypes(fields.types) ?? [],
      resolvedCanyonIds.length > 0,
    );
    const trip = await prisma.tripLog.create({
      data: {
        id: op.id,
        userId,
        date: tripDateFromPush(fields.date),
        displayName: trimmedDisplayName,
        types: parsedTypes,
        notes: (fields.notes as string | null | undefined) ?? null,
        customFields: (fields.customFields ?? {}) as Prisma.InputJsonValue,
        canyons: {
          create: resolvedCanyonIds.map((canyonId, position) => ({
            canyonId,
            position,
          })),
        },
      },
      include: tripCanyonsInclude,
    });
    return { opId: op.opId, status: "applied", row: serializeTrip(trip) };
  }

  // update — mirrors PATCH /trips/:id exactly (same helpers, same
  // canyoning-tag enforcement, same watermark force-touch).
  const trip = await prisma.tripLog.findUnique({
    where: { id: op.id },
    include: { canyons: { orderBy: { position: "asc" }, select: { canyonId: true } } },
  });
  if (!trip || trip.userId !== userId)
    throw new AppError(404, "Trip log not found");

  const resolvedCanyonIds =
    fields.canyonIds !== undefined
      ? await resolveTripCanyonIds(userId, fields.canyonIds)
      : undefined;
  const trimmedDisplayName = parseDisplayName(fields.displayName);
  const parsedTypes = parseTripTypes(fields.types);
  const { types: effectiveTypes, changed: typesChanged } =
    resolvePatchedTripTypes({
      parsedTypes,
      storedTypes: trip.types,
      resolvedCanyonIds,
      storedHasLinkedCanyon: trip.canyons.length > 0,
    });

  const currentForConflicts: Record<string, unknown> = {
    date: trip.date.toISOString(),
    displayName: trip.displayName,
    types: trip.types,
    notes: trip.notes,
    customFields: trip.customFields,
    canyonIds: trip.canyons.map((link) => link.canyonId),
  };
  // Normalize the incoming date for comparison so equal instants don't owe a
  // receipt over format differences.
  const incomingForConflicts: Record<string, unknown> = {
    ...fields,
    ...(fields.date !== undefined && {
      date: new Date(fields.date as string).toISOString(),
    }),
  };
  const conflicts = conflictReceipts(
    op.baseUpdatedAt,
    trip.updatedAt,
    incomingForConflicts,
    currentForConflicts,
  );

  const updated = await prisma.tripLog.update({
    where: { id: op.id },
    data: {
      ...(fields.date !== undefined && { date: tripDateFromPush(fields.date) }),
      ...(fields.notes !== undefined && {
        notes: fields.notes as string | null,
      }),
      ...(fields.customFields !== undefined && {
        customFields: (fields.customFields ?? Prisma.JsonNull) as Prisma.InputJsonValue,
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
        // Watermark force-touch — same §3.1 trap as the REST PATCH.
        updatedAt: new Date(),
      }),
    },
    include: tripCanyonsInclude,
  });
  return conflicts.length > 0
    ? {
        opId: op.opId,
        status: "appliedWithConflict",
        row: serializeTrip(updated),
        conflicts,
      }
    : { opId: op.opId, status: "applied", row: serializeTrip(updated) };
}

async function applyWaypointOp(
  userId: string,
  op: PushOp,
): Promise<PushOpResult> {
  if (op.op === "delete") {
    const waypoint = await prisma.waypoint.findUnique({ where: { id: op.id } });
    if (!waypoint || waypoint.ownerId !== userId) {
      return { opId: op.opId, status: "alreadyApplied" };
    }
    await prisma.$transaction(async (tx) => {
      await tx.waypoint.delete({ where: { id: op.id } });
      await writeTombstones(
        tx,
        waypointDeleteTombstones({ ownerId: userId, waypointId: op.id }),
      );
    });
    return { opId: op.opId, status: "applied" };
  }

  const fields = op.fields ?? {};
  assertKnownFields(fields, WAYPOINT_FIELDS);
  const validationError = validateWaypointPayload(fields, {
    requireCore: op.op === "create",
  });
  if (validationError) throw new AppError(400, validationError);

  // Owner-scoped association — foreign canyon id ≡ nonexistent (same rule as
  // routes/waypoints.ts).
  let resolvedCanyonId: string | null | undefined;
  if (fields.canyonId === undefined) resolvedCanyonId = undefined;
  else if (fields.canyonId === null) resolvedCanyonId = null;
  else if (typeof fields.canyonId === "string") {
    const owned = await prisma.canyon.count({
      where: { id: fields.canyonId, ownerId: userId },
    });
    if (owned !== 1) throw new AppError(400, "Canyon not found");
    resolvedCanyonId = fields.canyonId;
  } else {
    throw new AppError(400, "canyonId must be a string or null");
  }

  if (op.op === "create") {
    const existing = await prisma.waypoint.findUnique({ where: { id: op.id } });
    if (existing) {
      if (existing.ownerId !== userId)
        throw new AppError(404, "Waypoint not found");
      return { opId: op.opId, status: "alreadyApplied", row: existing };
    }
    if (await createAlreadyTombstoned(userId, "waypoint", op.id)) {
      return { opId: op.opId, status: "alreadyApplied" };
    }
    const waypoint = await prisma.waypoint.create({
      data: {
        id: op.id,
        ownerId: userId,
        canyonId: resolvedCanyonId ?? null,
        name: (fields.name as string).trim(),
        latitude: fields.latitude as number,
        longitude: fields.longitude as number,
        elevation: (fields.elevation as number | null | undefined) ?? null,
        symbol: (fields.symbol as string | null | undefined) ?? null,
        notes: (fields.notes as string | null | undefined) ?? null,
      },
    });
    return { opId: op.opId, status: "applied", row: waypoint };
  }

  // update
  const waypoint = await prisma.waypoint.findUnique({ where: { id: op.id } });
  if (!waypoint || waypoint.ownerId !== userId)
    throw new AppError(404, "Waypoint not found");
  const conflicts = conflictReceipts(
    op.baseUpdatedAt,
    waypoint.updatedAt,
    fields,
    waypoint as unknown as Record<string, unknown>,
  );
  const updated = await prisma.waypoint.update({
    where: { id: op.id },
    data: {
      ...(fields.name !== undefined && {
        name: (fields.name as string).trim(),
      }),
      ...(fields.latitude !== undefined && {
        latitude: fields.latitude as number,
      }),
      ...(fields.longitude !== undefined && {
        longitude: fields.longitude as number,
      }),
      ...(fields.elevation !== undefined && {
        elevation: fields.elevation as number | null,
      }),
      ...(fields.symbol !== undefined && {
        symbol: fields.symbol as string | null,
      }),
      ...(fields.notes !== undefined && {
        notes: fields.notes as string | null,
      }),
      ...(resolvedCanyonId !== undefined && { canyonId: resolvedCanyonId }),
    },
  });
  return conflicts.length > 0
    ? { opId: op.opId, status: "appliedWithConflict", row: updated, conflicts }
    : { opId: op.opId, status: "applied", row: updated };
}

async function applyRouteOp(
  userId: string,
  op: PushOp,
): Promise<PushOpResult> {
  if (op.op === "delete") {
    const route = await prisma.route.findUnique({ where: { id: op.id } });
    // Non-owner (including a sharee, who can see it but not change it) gets
    // the same alreadyApplied as a missing row — no existence oracle.
    if (!route || route.ownerId !== userId) {
      return { opId: op.opId, status: "alreadyApplied" };
    }
    await prisma.$transaction(async (tx) => {
      // Sharees of the linked canyon must forget it too. Read before delete.
      const shareeIds =
        route.canyonId === null ? [] : await canyonShareeIds(tx, route.canyonId);
      await tx.route.delete({ where: { id: op.id } });
      await writeTombstones(
        tx,
        routeDeleteTombstones({ ownerId: userId, routeId: op.id, shareeIds }),
      );
    });
    return { opId: op.opId, status: "applied" };
  }

  const fields = op.fields ?? {};
  assertKnownFields(fields, ROUTE_FIELDS);
  const validationError = validateRoutePayload(fields, {
    requireCore: op.op === "create",
  });
  if (validationError) throw new AppError(400, validationError);

  let points: [number, number][] | undefined;
  // Anchors travel with the geometry they index, exactly as in PATCH
  // /routes/:id — an op that moves points without sending anchors clears them,
  // never leaves stale indices into geometry that changed underneath them.
  let anchors: number[] | typeof Prisma.DbNull | undefined;
  if (fields.points !== undefined) {
    const parsed = parseRoutePoints(fields.points);
    if ("error" in parsed) throw new AppError(400, parsed.error);
    points = parsed.points;
    anchors = parseAnchorsOrNull(fields.anchors, parsed.points.length);
  }
  const resolvedCanyonId = await resolveRouteCanyonId(userId, fields.canyonId);

  if (op.op === "create") {
    const existing = await prisma.route.findUnique({ where: { id: op.id } });
    if (existing) {
      if (existing.ownerId !== userId) throw new AppError(404, "Route not found");
      return { opId: op.opId, status: "alreadyApplied", row: existing };
    }
    if (await createAlreadyTombstoned(userId, "route", op.id)) {
      return { opId: op.opId, status: "alreadyApplied" };
    }
    const created = await prisma.$transaction(async (tx) => {
      const route = await tx.route.create({
        data: {
          id: op.id,
          ownerId: userId,
          canyonId: null,
          name: (fields.name as string).trim(),
          color: randomTrackColor(),
          points: points!,
          anchors: anchors!,
        },
      });
      // Link through the shared helper so displacement + its tombstones have
      // exactly one implementation (lib/routeLink.ts).
      if (resolvedCanyonId) {
        await applyRouteCanyonLink(tx, {
          routeId: route.id,
          canyonId: resolvedCanyonId,
          currentCanyonId: null,
        });
        return tx.route.findUniqueOrThrow({ where: { id: route.id } });
      }
      return route;
    });
    return { opId: op.opId, status: "applied", row: created };
  }

  // update
  const route = await prisma.route.findUnique({ where: { id: op.id } });
  // A sharee may see this route but never edit it — same 404 as a stranger,
  // so the status can't distinguish "yours" from "someone else's".
  if (!route || route.ownerId !== userId) throw new AppError(404, "Route not found");
  const conflicts = conflictReceipts(
    op.baseUpdatedAt,
    route.updatedAt,
    fields,
    route as unknown as Record<string, unknown>,
  );
  const updated = await prisma.$transaction(async (tx) => {
    if (fields.name !== undefined || points !== undefined) {
      await tx.route.update({
        where: { id: op.id },
        data: {
          ...(fields.name !== undefined && {
            name: (fields.name as string).trim(),
          }),
          ...(points !== undefined && { points, anchors }),
        },
      });
    }
    if (resolvedCanyonId !== undefined) {
      await applyRouteCanyonLink(tx, {
        routeId: op.id,
        canyonId: resolvedCanyonId,
        currentCanyonId: route.canyonId,
      });
    }
    return tx.route.findUniqueOrThrow({ where: { id: op.id } });
  });
  return conflicts.length > 0
    ? { opId: op.opId, status: "appliedWithConflict", row: updated, conflicts }
    : { opId: op.opId, status: "applied", row: updated };
}

async function applyNotificationOp(
  userId: string,
  op: PushOp,
): Promise<PushOpResult> {
  // markRead is a monotonic one-way bit (§6): re-marking is a no-op, and a
  // row purged by PRIV cleanup counts as success — nothing to distinguish.
  const { count } = await prisma.notification.updateMany({
    where: { id: op.id, userId },
    data: { read: true },
  });
  return { opId: op.opId, status: count === 1 ? "applied" : "alreadyApplied" };
}

router.post(
  "/push",
  requireAuth,
  requireClientHeader,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const { protocol, ops } = (req.body ?? {}) as {
      protocol?: unknown;
      ops?: unknown;
    };
    if (protocol !== SYNC_PROTOCOL) {
      throw new AppError(400, `protocol must be ${SYNC_PROTOCOL}`);
    }
    if (!Array.isArray(ops) || ops.length === 0) {
      throw new AppError(400, "ops array is required");
    }
    if (ops.length > SYNC_PUSH_MAX_OPS) {
      throw new AppError(413, `At most ${SYNC_PUSH_MAX_OPS} ops per push`);
    }
    const parsed = ops.map((raw, index) => parsePushOp(raw, index));

    const results: PushOpResult[] = [];
    // Ids whose create (or a create they depended on) failed in THIS batch —
    // dependents are skipped as dependencyFailed instead of being sent to a
    // guaranteed 404 (§8.3).
    const failedIds = new Set<string>();
    // Ids created earlier in this batch (successfully) — a dependency on one
    // of these is satisfied even though it didn't exist when the batch began.
    const appliedCreateIds = new Set<string>();

    for (const op of parsed) {
      const failedDep = opDependencies(op).find((dep) => failedIds.has(dep));
      if (failedDep) {
        results.push({ opId: op.opId, status: "dependencyFailed" });
        if (op.op === "create") failedIds.add(op.id);
        continue;
      }
      try {
        let result: PushOpResult;
        switch (op.entity) {
          case "canyon":
            result = await applyCanyonOp(user.id, op);
            break;
          case "tripLog":
            result = await applyTripOp(user.id, op);
            break;
          case "waypoint":
            result = await applyWaypointOp(user.id, op);
            break;
          case "route":
            result = await applyRouteOp(user.id, op);
            break;
          case "notification":
            result = await applyNotificationOp(user.id, op);
            break;
        }
        results.push(result);
        if (op.op === "create") appliedCreateIds.add(op.id);
      } catch (err) {
        if (err instanceof AppError) {
          // Terminal per-op rejection: later independent ops still run.
          results.push({
            opId: op.opId,
            status: "rejected",
            error: { code: err.statusCode, message: err.message },
          });
          if (op.op === "create") failedIds.add(op.id);
        } else {
          // Unexpected failure: abort the whole request (500). Applied ops
          // stay applied; the client's whole-batch retry is safe — every op
          // class is idempotent (§8.1).
          throw err;
        }
      }
    }

    // Counts only — never op contents (§4.6.5).
    logger.info(
      {
        userId: user.id,
        opCount: parsed.length,
        statuses: results.reduce<Record<string, number>>((acc, r) => {
          acc[r.status] = (acc[r.status] ?? 0) + 1;
          return acc;
        }, {}),
      },
      "sync_push_applied",
    );

    res.json({ serverTime: new Date().toISOString(), results });
  },
);

export default router;
