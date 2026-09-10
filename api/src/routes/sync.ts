// Stage 8 delta sync — the mobile mirror's read path (stage8-sync.md §4).
//
// PRIVACY INVARIANTS (§4.6, test-enforced by __tests__/syncBoundary.test.ts):
// 1. No request parameter ever names an entity — everything derives from the
//    caller's own visibility set, so the endpoint cannot be an oracle for
//    foreign ids at all (stronger than 404-not-403: no id slot to probe).
// 2. A sharee's delta never contains trip logs, trip media, or co-sharee
//    rows; user joins are username-only (never email).
// 3. Unshare and place-delete emit the SAME sharee signal (a `place`
//    tombstone) — deliberately indistinguishable.
// 4. Logging: counts and cursor timestamps only — never row contents.
import { Router, Response, NextFunction } from "express";
import { Prisma, type Place } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { readMediaMetadata, SYSTEM_FIELD_DEFS } from "@logjam/shared";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  assertValidPlaceType,
  createPlaceType,
  defsForPlaceType,
  deletePlaceType,
  requireOwnPlaceType,
  resolvePlaceTypeId,
} from "../lib/placeTypes";
import { getEnv } from "../lib/env";
import { logger } from "../lib/logger";
import { resolveUser } from "../lib/resolveUser";
import {
  decodeSyncCursor,
  encodeSyncCursor,
  enforceCanyoningTag,
  isCustomFieldEntity,
  isUuidV4,
  SYNC_DELTA_DEFAULT_LIMIT,
  SYNC_DELTA_MAX_LIMIT,
  SYNC_DELTA_ROUTE_LIMIT,
  SYNC_OVERLAP_MS,
  SYNC_PROTOCOL,
  SYNC_PUSH_MAX_OPS,
  SYNC_PUSH_OPS_BY_ENTITY,
  pushOpDependencies,
  asFieldValues,
  validatePlacePayload,
  type TripLogCustomFieldDef,
  validateRoutePayload,
  canonicalLinkPair,
  parseRouteColor,
  parseRoutePoints,
  pickNextTrackColor,
  type SyncCursor,
  type SyncCursorKeysets,
  type SyncPushOp,
} from "@logjam/shared";
import {
  parseDisplayName,
  parseTripTypes,
  resolvePatchedTripTypes,
  resolveTripPlaceIds,
  serializeTrip,
  tripPlacesInclude,
} from "./tripLogsGlobal";
import { validatePlaceTextFields } from "./places";
import { strandValuesOnTypeChange } from "../lib/placeCopy";
import { serializeSharedPlace } from "../lib/placeVisibility";
import {
  assertValidDef,
  createFieldDef,
  deleteFieldDef,
  updateFieldDef,
} from "../lib/customFieldDefs";
import { deletePlacesCascade, deleteTripsCascade } from "../lib/bulkDelete";
import {
  directShareRevokeTombstones,
  routeDeleteTombstones,
  placeLinkDeleteTombstones,
  placeTypeDeleteTombstones,
  writeTombstones,
} from "../lib/syncTombstones";
import {
  applyRoutePlaceLink,
  placeShareeIds,
  parseAnchorsOrNull,
  resolveRoutePlaceId,
} from "../lib/routeLink";
import {
  deleteSharesFor,
  directlySharedIds,
  directShareeIds,
  shareCountsFor,
} from "../lib/shareAccess";

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
          placeTypes: [],
          customFieldDefs: [],
          places: [],
          placeLinks: [],
          tripLogs: [],
          routes: [],
          media: [],
          placeShares: [],
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
    const sharedPlaceRows = await prisma.placeShare.findMany({
      where: { sharedWithId: user.id },
      select: { placeId: true },
    });
    const sharedPlaceIds = sharedPlaceRows.map((row) => row.placeId);
    // Direct per-item shares — the second, independent source of visibility
    // (lib/shareAccess.ts). Share.entityId is polymorphic so there is no
    // relation filter to express this with; the ids come back as a set.
    const directRouteIds = await directlySharedIds(user.id, "route");

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

    // TYPES LEAD, ahead of the definitions, because a definition points at the
    // types it is scoped to — a defs page applied first would carry scopings
    // naming rows the mirror does not have yet. Same argument as defs before
    // values, one level up.
    //
    // The caller's own types AND the SYSTEM ones (ownerId null): system types
    // are global, one row shared by everyone, and a client that did not hold
    // them could not render its own canyons. A client must not read a null
    // owner as "mine" — see SyncDeltaPlaceTypeRow.
    const placeTypes = await fill(
      "placeTypes",
      (after, take) =>
        prisma.placeType.findMany({
          where: {
            AND: [
              { OR: [{ ownerId: user.id }, { ownerId: null }] },
              keysetWhere("updatedAt", since, after),
            ],
          },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take,
        }),
      (row) => row.updatedAt,
    );

    // Definitions follow: a place's and a trip's stored values are keyed by
    // them, so a client applying an early page has the labels before the rows
    // that need them. The caller's own PLUS the system definitions, which
    // label the built-in fields and belong to no account.
    const customFieldDefRows = await fill(
      "customFieldDefs",
      (after, take) =>
        prisma.customFieldDef.findMany({
          where: {
            AND: [
              { OR: [{ ownerId: user.id }, { ownerId: null }] },
              keysetWhere("updatedAt", since, after),
            ],
          },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take,
          // The SCOPING rides with the definition. `CustomFieldDefPlaceType` is
          // not a sync entity of its own, so without this join a client holds
          // every definition and cannot tell which form any of them belongs on
          // — it would render a canyon's grades on a campsite.
          include: { placeTypes: { select: { placeTypeId: true } } },
        }),
      (row) => row.updatedAt,
    );
    const customFieldDefs = customFieldDefRows.map(({ placeTypes, ...def }) => ({
      ...def,
      placeTypeIds: placeTypes.map((link) => link.placeTypeId),
    }));

    // For a shared place of a USER type, the recipient owns none of the sender's
    // definitions, so without this they would see bare keys where the values
    // should be labelled. Derived LIVE from the OWNER's current definitions
    // rather than persisted, so a renamed field renames on the sharee's screen
    // too. System types need none: the recipient already holds the same rows.
    const sharedDefsByType = new Map<string, TripLogCustomFieldDef[]>();

    const places = await fill(
      "places",
      (after, take) =>
        prisma.place.findMany({
          where: {
            AND: [
              {
                OR: [
                  { ownerId: user.id },
                  { id: { in: sharedPlaceIds } },
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

    for (const place of places) {
      if (place.ownerId === user.id) continue;
      if (sharedDefsByType.has(place.placeTypeId)) continue;
      const type = await prisma.placeType.findUnique({
        where: { id: place.placeTypeId },
        select: { ownerId: true },
      });
      if (!type || type.ownerId === null) continue; // system type: already held
      sharedDefsByType.set(
        place.placeTypeId,
        await defsForPlaceType(type.ownerId, place.placeTypeId),
      );
    }

    // A link is OWNER-PRIVATE: both its endpoints belong to `ownerId` (asserted
    // server-side on create), so filtering to the caller's own rows IS the
    // both-endpoints-visible rule of §2.5, expressed without a two-hop join on
    // every page. A sharee gets no links at all — which is the point: they must
    // never learn the owner also filed that carpark under three places they
    // cannot see.
    const placeLinks = await fill(
      "placeLinks",
      (after, take) =>
        prisma.placeLink.findMany({
          where: {
            AND: [{ ownerId: user.id }, keysetWhere("updatedAt", since, after)],
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
          include: tripPlacesInclude,
        }),
      (row) => row.updatedAt,
    );

    // Owned routes, routes LINKED to a place shared with me (a linked route is
    // part of the shared place record), and routes shared with me DIRECTLY. An
    // unlinked, unshared route of another owner can never match.
    const routes = await fill(
      "routes",
      (after, take) =>
        prisma.route.findMany({
          where: {
            AND: [
              {
                OR: [
                  { ownerId: user.id },
                  { placeId: { in: sharedPlaceIds } },
                  { id: { in: directRouteIds } },
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
                // Own media — including standalone files (imports, recorded
                // tracks), which have no parent at all — plus place-level
                // media of places shared with me, exactly what a sharee can
                // already fetch via GET /places/:id. Trip media of other
                // owners can never match (its linkedType is "tripLog"), and
                // neither can anyone else's standalone files ("none").
                OR: [
                  { ownerId: user.id },
                  {
                    linkedType: "place",
                    linkedId: { in: sharedPlaceIds },
                  },
                ],
              },
              // Keysets on updatedAt, not createdAt. A media row used to be
              // immutable; linking a file to a place and unlinking it again
              // mutates one, and a createdAt keyset would never redeliver it —
              // the other device would show a stale parent forever.
              keysetWhere("updatedAt", since, after),
            ],
          },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take,
        }),
      (row) => row.updatedAt,
    );

    const placeShares = await fill(
      "placeShares",
      (after, take) =>
        prisma.placeShare.findMany({
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
          placeTypes: placeTypes.length,
          customFieldDefs: customFieldDefs.length,
          places: places.length,
          placeLinks: placeLinks.length,
          tripLogs: tripLogs.length,
          routes: routes.length,
          media: media.length,
          placeShares: placeShares.length,
          friendships: friendships.length,
          tombstones: tombstones.length,
        },
      },
      "sync_delta_served",
    );

    // Direct-share fan-out for the rows on THIS page, two grouped queries
    // rather than one per row. Scoped to OWNED ids at the call site: a share
    // count is owner-private derived cardinality (root CLAUDE.md), so a
    // recipient's copy of a row must not carry one.
    const routeShareCounts = await shareCountsFor(
      "route",
      routes.filter((row) => row.ownerId === user.id).map((row) => row.id),
    );

    // Ids delivered as live rows in this same page, by tombstone entityType.
    const liveIds = new Map<string, Set<string>>([
      ["place", new Set(places.map((row) => row.id))],
      ["tripLog", new Set(tripLogs.map((row) => row.id))],
      ["placeLink", new Set(placeLinks.map((row) => row.id))],
      ["route", new Set(routes.map((row) => row.id))],
      ["media", new Set(media.map((row) => row.id))],
      ["placeShare", new Set(placeShares.map((row) => row.id))],
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
        placeTypes,
        customFieldDefs,
        places: places.map((place) => serializePlace(place, user.id, sharedDefsByType)),
        // No syncRole and no sharedCount: a link is owner-private, so every row
        // here is the caller's own and neither field would ever vary.
        placeLinks,
        tripLogs: tripLogs.map(serializeTrip),
        // Geometry travels INLINE (no blob leg). syncRole tells the client
        // whether this is its own route or one seen through a place share —
        // a 'shared' route is read-only there.
        routes: routes.map((route) => {
          const isOwner = route.ownerId === user.id;
          return {
            syncRole: isOwner ? "owner" : "shared",
            ...route,
            // Owner-only: the fan-out of a share is owner-private derived
            // cardinality (root CLAUDE.md).
            ...(isOwner
              ? { sharedCount: routeShareCounts.get(route.id) ?? 0 }
              : {}),
          };
        }),
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
          origin: row.origin,
          displayName: row.displayName,
          // Row-level stats, so the other device can LIST an import or a
          // recording without downloading its blob (§7.3).
          metadata: readMediaMetadata(row.origin, row.metadata),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        placeShares,
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
      // pull deleted the place, its cached media and its blobs. Same shape
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
// `foreignFields` is DELIBERATELY ABSENT and must stay absent. It is written
// only by copy and by a place-type change — never by a user edit — because it
// exists to record what the SENDER's definitions said, and a client that could
// write it could forge that provenance or resurrect values the owner discarded.
// An unknown key is a per-op 400, so its absence here is the enforcement, not a
// convention. Guard: placeFields.unit.test.ts.
export const PLACE_FIELDS = new Set([
  "name",
  "altNames",
  "latitude",
  "longitude",
  "placeTypeId",
  "notes",
  "fieldValues",
  // Folded in from WAYPOINT_FIELDS: every waypoint is a place now, and the two
  // columns it carried that a canyon did not came with it. `symbol` did NOT —
  // the icon is the place TYPE's, and mobile's waypointSymbol.ts said outright
  // that nothing ever wrote the column.
  "elevation",
]);
const TRIP_FIELDS = new Set([
  "date",
  "displayName",
  "types",
  "notes",
  "customFields",
  "placeIds",
]);
// `color` is client-settable, but only to a value from TRACK_COLORS (see
// parseRouteColor): routes share one palette with legacy track media so the map
// reads as one thing, and a free-text colour would reach every style expression
// that draws a route.
const ROUTE_FIELDS = new Set(["name", "points", "anchors", "placeId", "color"]);

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

async function applyPlaceOp(userId: string, op: PushOp): Promise<PushOpResult> {
  if (op.op === "delete") {
    const deleted = await deletePlacesCascade(userId, [op.id]);
    // Row already gone (or never visible): idempotent success — a delete's
    // goal state is "not there" (§8.1), and distinguishing foreign from
    // missing would be an oracle.
    return { opId: op.opId, status: deleted.length ? "applied" : "alreadyApplied" };
  }

  const fields = op.fields ?? {};
  assertKnownFields(fields, PLACE_FIELDS);
  // Same two validators the REST twins run, in the same order — REST/sync
  // divergence here is the SEC-001 failure mode, and a mistyped free-text field
  // that reaches Prisma throws a non-AppError, which the per-op catch re-throws
  // and 500s the WHOLE batch (a poison pill that never drains).
  const validationError = validatePlaceTextFields(fields);
  if (validationError) throw new AppError(400, validationError);

  if (op.op === "create") {
    if (!fields.name || fields.latitude === undefined || fields.longitude === undefined) {
      throw new AppError(400, "name, latitude, and longitude are required");
    }
    const existing = await prisma.place.findUnique({ where: { id: op.id } });
    if (existing) {
      if (existing.ownerId !== userId)
        throw new AppError(404, "Place not found");
      return { opId: op.opId, status: "alreadyApplied", row: existing };
    }
    if (await createAlreadyTombstoned(userId, "place", op.id)) {
      return { opId: op.opId, status: "alreadyApplied" };
    }
    const typeId = await resolvePlaceTypeId(userId, fields.placeTypeId);
    // Same two validators the REST twin runs, in the same order — REST/sync
    // divergence here is the SEC-001 failure mode. The field-value bounds come
    // from the definitions in force for the type, so they can only be resolved
    // once the type is.
    const createError = validatePlacePayload(fields, {
      requireCoords: true,
      defs: await defsForPlaceType(userId, typeId),
    });
    if (createError) throw new AppError(400, createError);

    const place = await prisma.place.create({
      data: {
        id: op.id,
        ownerId: userId,
        placeTypeId: typeId,
        name: fields.name as string,
        altNames: (fields.altNames as string[] | undefined) ?? [],
        latitude: fields.latitude as number,
        longitude: fields.longitude as number,
        notes: (fields.notes as string | null | undefined) ?? null,
        elevation: (fields.elevation as number | null | undefined) ?? null,
        fieldValues: asFieldValues(fields.fieldValues) as Prisma.InputJsonValue,
      },
    });
    return { opId: op.opId, status: "applied", row: place };
  }

  // update
  const place = await prisma.place.findUnique({ where: { id: op.id } });
  // Deleted-or-foreign → the same 404 the REST PATCH gives (client parks as
  // deadRemote; delete-wins per §6).
  if (!place || place.ownerId !== userId)
    throw new AppError(404, "Place not found");

  // A type change is a legal edit (miscategorising is inevitable, and
  // delete-and-recreate would lose media, route, links and trips). Values the
  // NEW type has no definition for are PARKED in `foreignFields` rather than
  // destroyed or left in `fieldValues` where nothing renders them — §2.6, and
  // the second of that field's two writers (the other is copy).
  const typeId =
    fields.placeTypeId !== undefined
      ? await resolvePlaceTypeId(userId, fields.placeTypeId)
      : place.placeTypeId;
  const updateError = validatePlacePayload(fields, {
    requireCoords: false,
    defs: await defsForPlaceType(userId, typeId),
  });
  if (updateError) throw new AppError(400, updateError);

  const conflicts = conflictReceipts(
    op.baseUpdatedAt,
    place.updatedAt,
    fields,
    place as unknown as Record<string, unknown>,
  );
  // Stranding runs over the values as they will be AFTER this op: an op that
  // retypes and writes values in one go must reconcile what it wrote, not what
  // the row held before it.
  const nextValues =
    fields.fieldValues !== undefined
      ? asFieldValues(fields.fieldValues)
      : asFieldValues(place.fieldValues);
  const stranded =
    fields.placeTypeId !== undefined && typeId !== place.placeTypeId
      ? await strandValuesOnTypeChange({
          ownerId: userId,
          fromTypeId: place.placeTypeId,
          toTypeId: typeId,
          fieldValues: nextValues,
          foreignFields: place.foreignFields,
        })
      : null;

  const updated = await prisma.place.update({
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
      ...(fields.placeTypeId !== undefined && { placeTypeId: typeId }),
      ...(fields.notes !== undefined && { notes: fields.notes as string | null }),
      ...(fields.elevation !== undefined && {
        elevation: fields.elevation as number | null,
      }),
      ...(fields.fieldValues !== undefined && {
        fieldValues: asFieldValues(fields.fieldValues) as Prisma.InputJsonValue,
      }),
      // The type change overrides both, because it is derived FROM them.
      ...(stranded
        ? {
            fieldValues: stranded.fieldValues as Prisma.InputJsonValue,
            foreignFields:
              stranded.foreignFields.length > 0
                ? (stranded.foreignFields as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
          }
        : {}),
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
      include: tripPlacesInclude,
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
    const resolvedPlaceIds = await resolveTripPlaceIds(
      userId,
      fields.placeIds,
    );
    const trimmedDisplayName = parseDisplayName(fields.displayName) ?? null;
    const parsedTypes = enforceCanyoningTag(
      parseTripTypes(fields.types) ?? [],
      resolvedPlaceIds.length > 0,
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
        places: {
          create: resolvedPlaceIds.map((placeId, position) => ({
            placeId,
            position,
          })),
        },
      },
      include: tripPlacesInclude,
    });
    return { opId: op.opId, status: "applied", row: serializeTrip(trip) };
  }

  // update — mirrors PATCH /trips/:id exactly (same helpers, same
  // canyoning-tag enforcement, same watermark force-touch).
  const trip = await prisma.tripLog.findUnique({
    where: { id: op.id },
    include: { places: { orderBy: { position: "asc" }, select: { placeId: true } } },
  });
  if (!trip || trip.userId !== userId)
    throw new AppError(404, "Trip log not found");

  const resolvedPlaceIds =
    fields.placeIds !== undefined
      ? await resolveTripPlaceIds(userId, fields.placeIds)
      : undefined;
  const trimmedDisplayName = parseDisplayName(fields.displayName);
  const parsedTypes = parseTripTypes(fields.types);
  const { types: effectiveTypes, changed: typesChanged } =
    resolvePatchedTripTypes({
      parsedTypes,
      storedTypes: trip.types,
      resolvedPlaceIds,
      storedHasLinkedPlace: trip.places.length > 0,
    });

  const currentForConflicts: Record<string, unknown> = {
    date: trip.date.toISOString(),
    displayName: trip.displayName,
    types: trip.types,
    notes: trip.notes,
    customFields: trip.customFields,
    placeIds: trip.places.map((link) => link.placeId),
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
      ...(resolvedPlaceIds !== undefined && {
        places: {
          deleteMany: {},
          create: resolvedPlaceIds.map((placeId, position) => ({
            placeId,
            position,
          })),
        },
        // Watermark force-touch — same §3.1 trap as the REST PATCH.
        updatedAt: new Date(),
      }),
    },
    include: tripPlacesInclude,
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

// A LINK op carries no fields to edit — `create` names its two endpoints,
// `delete` names the link id, and that is the whole vocabulary (there is no
// `update` in SYNC_PUSH_OPS_BY_ENTITY, because a fieldless row has nothing to
// merge). The pair is canonicalised here as well as on the client: two devices
// linking the same two places from opposite ends must collide on the unique
// index rather than store the link twice.
const PLACE_LINK_FIELDS = new Set(["aPlaceId", "bPlaceId"]);

async function applyPlaceLinkOp(
  userId: string,
  op: PushOp,
): Promise<PushOpResult> {
  if (op.op === "delete") {
    const link = await prisma.placeLink.findUnique({ where: { id: op.id } });
    // Non-owner gets the same alreadyApplied as a missing row — no existence
    // oracle. (Nobody but the owner can see a link at all, so this is the
    // stranger case only.)
    if (!link || link.ownerId !== userId) {
      return { opId: op.opId, status: "alreadyApplied" };
    }
    await prisma.$transaction(async (tx) => {
      await tx.placeLink.delete({ where: { id: op.id } });
      // Owner-only fan-out: a link grants no visibility, so no sharee ever held
      // this row. The owner's OTHER devices still need to be told.
      await writeTombstones(
        tx,
        placeLinkDeleteTombstones({ ownerId: userId, linkIds: [op.id] }),
      );
    });
    return { opId: op.opId, status: "applied" };
  }

  const fields = op.fields ?? {};
  assertKnownFields(fields, PLACE_LINK_FIELDS);
  const first = fields.aPlaceId;
  const second = fields.bPlaceId;
  if (typeof first !== "string" || typeof second !== "string") {
    throw new AppError(400, "aPlaceId and bPlaceId are required");
  }
  if (first === second) {
    throw new AppError(400, "A place cannot be linked to itself");
  }
  const { aPlaceId, bPlaceId } = canonicalLinkPair(first, second);

  // BOTH endpoints must be the caller's own. This is the assertion that makes
  // `ownerId` trustworthy everywhere else — the delta filter, the tombstone
  // fan-out and the "a link grants no visibility" rule all read it and none of
  // them re-checks the endpoints. A foreign or nonexistent place id is the same
  // 404 either way (404-not-403): an offline client must not be able to probe
  // for place ids by watching which links the server accepts.
  const owned = await prisma.place.count({
    where: { id: { in: [aPlaceId, bPlaceId] }, ownerId: userId },
  });
  if (owned !== 2) throw new AppError(404, "Place not found");

  const existing = await prisma.placeLink.findUnique({ where: { id: op.id } });
  if (existing) {
    if (existing.ownerId !== userId) throw new AppError(404, "Link not found");
    return { opId: op.opId, status: "alreadyApplied", row: existing };
  }
  if (await createAlreadyTombstoned(userId, "placeLink", op.id)) {
    return { opId: op.opId, status: "alreadyApplied" };
  }
  // The same pair from a second device carries a DIFFERENT client-minted id, so
  // the unique index is the only thing that stops a duplicate. Return the row
  // that won rather than an error: both devices asked for the same state and
  // they now both have it.
  const duplicate = await prisma.placeLink.findUnique({
    where: { ownerId_aPlaceId_bPlaceId: { ownerId: userId, aPlaceId, bPlaceId } },
  });
  if (duplicate) {
    return { opId: op.opId, status: "alreadyApplied", row: duplicate };
  }
  const link = await prisma.placeLink.create({
    data: { id: op.id, ownerId: userId, aPlaceId, bPlaceId },
  });
  return { opId: op.opId, status: "applied", row: link };
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
      // Sharees of the linked place must forget it too. Read before delete.
      const shareeIds =
        route.placeId === null ? [] : await placeShareeIds(tx, route.placeId);
      // Direct recipients likewise — read before the rows go, so the tombstone
      // fan-out and the Share cleanup match the REST DELETE (routes.ts).
      const directIds = await directShareeIds(tx, "route", op.id);
      await deleteSharesFor(tx, "route", [op.id]);
      await tx.route.delete({ where: { id: op.id } });
      await writeTombstones(tx, [
        ...routeDeleteTombstones({ ownerId: userId, routeId: op.id, shareeIds }),
        ...directShareRevokeTombstones({
          entityType: "route",
          entityId: op.id,
          userIds: directIds,
        }),
      ]);
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
  const color = parseRouteColor(fields.color) ?? undefined;
  let anchors: number[] | typeof Prisma.DbNull | undefined;
  if (fields.points !== undefined) {
    const parsed = parseRoutePoints(fields.points);
    if ("error" in parsed) throw new AppError(400, parsed.error);
    points = parsed.points;
    anchors = parseAnchorsOrNull(fields.anchors, parsed.points.length);
  }
  const resolvedPlaceId = await resolveRoutePlaceId(userId, fields.placeId);

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
      let assignedColor = color;
      if (!assignedColor) {
        const existingRoutes = await tx.route.findMany({
          where: resolvedPlaceId
            ? { OR: [{ ownerId: userId }, { placeId: resolvedPlaceId }] }
            : { ownerId: userId },
          select: { color: true },
        });
        assignedColor = pickNextTrackColor(existingRoutes.map((r) => r.color));
      }

      const route = await tx.route.create({
        data: {
          id: op.id,
          ownerId: userId,
          placeId: null,
          name: (fields.name as string).trim(),
          color: assignedColor,
          points: points!,
          anchors: anchors!,
        },
      });
      // Link through the shared helper so displacement + its tombstones have
      // exactly one implementation (lib/routeLink.ts).
      if (resolvedPlaceId) {
        await applyRoutePlaceLink(tx, {
          routeId: route.id,
          placeId: resolvedPlaceId,
          currentPlaceId: null,
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
    if (fields.name !== undefined || points !== undefined || color !== undefined) {
      await tx.route.update({
        where: { id: op.id },
        data: {
          ...(fields.name !== undefined && {
            name: (fields.name as string).trim(),
          }),
          ...(points !== undefined && { points, anchors }),
          ...(color !== undefined && { color }),
        },
      });
    }
    if (resolvedPlaceId !== undefined) {
      await applyRoutePlaceLink(tx, {
        routeId: op.id,
        placeId: resolvedPlaceId,
        currentPlaceId: route.placeId,
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
  // Owner-scoped by `userId` in the filter, so a foreign id is indistinguishable
  // from a purged one and neither the status nor an error can confirm that a
  // notification exists (the house anti-oracle rule, as in routes/notifications.ts).
  //
  // A row purged by PRIV cleanup counts as success — there is nothing left to
  // apply. markRead/markUnread are idempotent writes of one bit rather than a
  // monotonic latch, so a replayed op is harmless; the outbox's FIFO order is
  // what makes the last flip the winner.
  if (op.op === "delete") {
    const { count } = await prisma.notification.deleteMany({
      where: { id: op.id, userId },
    });
    return { opId: op.opId, status: count === 1 ? "applied" : "alreadyApplied" };
  }
  const { count } = await prisma.notification.updateMany({
    where: { id: op.id, userId },
    data: { read: op.op === "markRead" },
  });
  return { opId: op.opId, status: count === 1 ? "applied" : "alreadyApplied" };
}

// `entity` and `key` are absent from the UPDATE surface on purpose: `entity`
// decides which table the values live in, and `key` is what every stored value
// is keyed by — changing either orphans data rather than editing it. A rename
// moves `label` only (renameCustomFieldLabel).
//
// `placeTypeIds` and `appliesToAllTypes` are on BOTH lists deliberately.
// CustomFieldDefPlaceType is not a sync entity of its own, so without them a
// definition created offline and scoped to two types could not express that
// scoping on the wire — it would arrive unscoped and apply to nothing.
const CUSTOM_FIELD_DEF_CREATE_FIELDS = new Set([
  "entity",
  "key",
  "label",
  "type",
  "min",
  "max",
  "position",
  "placeTypeIds",
  "appliesToAllTypes",
]);
const CUSTOM_FIELD_DEF_UPDATE_FIELDS = new Set([
  "label",
  "type",
  "min",
  "max",
  "position",
  "placeTypeIds",
  "appliesToAllTypes",
]);

/** A `placeTypeIds` field off the wire, or undefined when absent. Anything that
 *  is not an array of strings is a 400 rather than a silent empty scoping — a
 *  definition that applies to nothing is indistinguishable from one the user
 *  never finished creating. */
function parsePlaceTypeIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new AppError(400, "placeTypeIds must be an array of ids");
  }
  return value as string[];
}

/**
 * A place on the wire.
 *
 * TWO THINGS THIS DECIDES, both privacy boundaries rather than formatting:
 *
 * `foreignFields` is OWNER-PRIVATE and is stripped from any row the caller does
 * not own. It records what the SENDER's definitions said about values this
 * owner has no definition for, so emitting it to a sharee reproduces exactly
 * the propagation problem that got the "append it to the notes field" design
 * rejected: B copies A's place, B shares it with C, and C reads A's field
 * labels and values. Enforced HERE rather than by the client declining to
 * render it — a client that looks away is not a boundary (the SEC-001 shape).
 *
 * `fieldDefsSnapshot` is what a sharee gets instead, and only for a place of a
 * type they do not own: the labels and bounds for the keys on this row, derived
 * live from the OWNER's current definitions. Without it a sharee sees bare keys.
 */
function serializePlace(
  place: Place,
  viewerId: string,
  defsByType: Map<string, TripLogCustomFieldDef[]>,
) {
  if (place.ownerId === viewerId) {
    return { syncRole: "owner" as const, ...place };
  }
  // One denylist for every sharee-facing surface (lib/placeVisibility.ts), so
  // the delta and the REST responses cannot disagree about what is
  // owner-private — and so a column added to `Place` reaches a sharee only
  // after someone classifies it. This used to strip `foreignFields` by name,
  // which meant `importKey` and `importBatchId` — the owner's filing, not the
  // record — rode along.
  const snapshot = defsByType.get(place.placeTypeId);
  return {
    syncRole: "shared" as const,
    ...serializeSharedPlace(place as unknown as Record<string, unknown>),
    ...(snapshot?.length ? { fieldDefsSnapshot: snapshot } : {}),
  };
}

// A place type is created, renamed and deleted OFFLINE like every other
// user-made row (§2.9), so it needs a push op — building type creation as an
// online-only path would make it the one thing a user could not do in a gorge,
// and would break guest installs entirely.
const PLACE_TYPE_FIELDS = new Set(["name", "iconKey", "color", "position"]);

async function applyPlaceTypeOp(
  userId: string,
  op: PushOp,
): Promise<PushOpResult> {
  if (op.op === "delete") {
    const existing = await prisma.placeType.findFirst({
      where: { id: op.id, ownerId: userId },
      select: { id: true },
    });
    // Already gone is idempotent success — a delete's goal state is "not
    // there" (§8.1), and the push path replays ops. A SYSTEM type also lands
    // here (it has no owner), and answering alreadyApplied for one would be a
    // lie the phone then acts on, so it is a rejection instead.
    if (!existing) {
      const system = await prisma.placeType.findFirst({
        where: { id: op.id, ownerId: null },
        select: { id: true },
      });
      if (system) {
        throw new AppError(403, "Built-in place types cannot be deleted.");
      }
      return { opId: op.opId, status: "alreadyApplied" };
    }
    const result = await deletePlaceType(userId, op.id);
    if (!result.ok) {
      throw new AppError(
        409,
        `That type still has ${result.placeCount} place${result.placeCount === 1 ? "" : "s"} in it. Move them to another type first.`,
      );
    }
    await writeTombstones(
      prisma,
      placeTypeDeleteTombstones({ ownerId: userId, placeTypeId: op.id }),
    );
    return { opId: op.opId, status: "applied" };
  }

  const fields = op.fields ?? {};

  if (op.op === "create") {
    assertKnownFields(fields, PLACE_TYPE_FIELDS);
    const existing = await prisma.placeType.findUnique({ where: { id: op.id } });
    if (existing) {
      // Foreign id gets the same 404 a missing one would — no existence oracle.
      if (existing.ownerId !== userId) {
        throw new AppError(404, "Place type not found");
      }
      return { opId: op.opId, status: "alreadyApplied", row: existing };
    }
    if (await createAlreadyTombstoned(userId, "placeType", op.id)) {
      return { opId: op.opId, status: "alreadyApplied" };
    }
    const row = await createPlaceType(userId, op.id, assertValidPlaceType(fields));
    return { opId: op.opId, status: "applied", row };
  }

  assertKnownFields(fields, PLACE_TYPE_FIELDS);
  const current = await requireOwnPlaceType(userId, op.id);
  const conflicts = conflictReceipts(
    op.baseUpdatedAt,
    current.updatedAt,
    fields,
    current as unknown as Record<string, unknown>,
  );
  // Validate the RESULT, not the patch: a patch that only moves `color` still
  // has to produce a type whose icon and colour are both in the curated lists.
  const merged = assertValidPlaceType({
    name: fields.name ?? current.name,
    iconKey: fields.iconKey ?? current.iconKey,
    color: fields.color ?? current.color,
    position: fields.position ?? current.position,
  });
  const row = await prisma.placeType.update({
    where: { id: op.id },
    data: merged,
  });
  return {
    opId: op.opId,
    status: conflicts.length ? "appliedWithConflict" : "applied",
    row,
    ...(conflicts.length ? { conflicts } : {}),
  };
}

/** The ids no account owns. A push naming one is a client bug, not a race. */
const SYSTEM_FIELD_DEF_IDS = new Set(SYSTEM_FIELD_DEFS.map((def) => def.id));

async function applyCustomFieldDefOp(
  userId: string,
  op: PushOp,
): Promise<PushOpResult> {
  if (op.op === "delete") {
    // A SYSTEM definition is REFUSED, loudly. It is not "already gone" — it is
    // there, it belongs to no account, and it always will be, so answering
    // `alreadyApplied` told a buggy client its delete had succeeded. That is
    // exactly what let the phone destroy data quietly: its half of a delete
    // (strip the value off every place carrying the key) had already run, the
    // definition came back on the next pull, and the values did not.
    if (SYSTEM_FIELD_DEF_IDS.has(op.id)) {
      throw new AppError(404, "Custom field not found");
    }
    // Strips the orphaned values off every trip log / place that carried one
    // and writes the tombstone, in one transaction (lib/customFieldDefs.ts).
    // A definition already gone is idempotent success — a delete's goal state
    // is "not there" (§8.1).
    const result = await deleteFieldDef(userId, op.id);
    return {
      opId: op.opId,
      status: result ? "applied" : "alreadyApplied",
    };
  }

  const fields = op.fields ?? {};

  if (op.op === "create") {
    assertKnownFields(fields, CUSTOM_FIELD_DEF_CREATE_FIELDS);
    const existing = await prisma.customFieldDef.findUnique({
      where: { id: op.id },
    });
    if (existing) {
      // Foreign id gets the same 404 a missing one would — no existence oracle.
      if (existing.ownerId !== userId) {
        throw new AppError(404, "Custom field not found");
      }
      return { opId: op.opId, status: "alreadyApplied", row: existing };
    }
    if (await createAlreadyTombstoned(userId, "customFieldDef", op.id)) {
      return { opId: op.opId, status: "alreadyApplied" };
    }
    if (!isCustomFieldEntity(fields.entity)) {
      throw new AppError(400, "Invalid entity");
    }
    // EACH BOUND INDEPENDENTLY. Gating on both dropped every one-sided bound
    // on its way through this path — and one-sided is the normal case for a
    // "how many" field, three of the system defs included. The def then landed
    // unbounded, so the form stopped showing the range and nothing refused a
    // negative. `assertValidDef` accepts either alone (§5.1).
    const def = assertValidDef({
      key: fields.key,
      label: fields.label,
      type: fields.type,
      ...(typeof fields.min === "number" ? { min: fields.min } : {}),
      ...(typeof fields.max === "number" ? { max: fields.max } : {}),
    });
    // A key this owner already uses for this entity is a 409, which the push
    // loop turns into a `rejected` op the user sees. Deliberately NOT folded
    // into alreadyApplied: the server row has a different id, so silently
    // accepting would leave the phone mirroring a duplicate definition under
    // its own id forever. Two devices that both invented "Water level" offline
    // is a real collision and the user is the one who can resolve it.
    await createFieldDef(userId, fields.entity, {
      id: op.id,
      def,
      ...(typeof fields.position === "number"
        ? { position: fields.position }
        : {}),
      ...(parsePlaceTypeIds(fields.placeTypeIds) !== undefined
        ? { placeTypeIds: parsePlaceTypeIds(fields.placeTypeIds) }
        : {}),
      ...(typeof fields.appliesToAllTypes === "boolean"
        ? { appliesToAllTypes: fields.appliesToAllTypes }
        : {}),
    });
    const row = await prisma.customFieldDef.findUnique({ where: { id: op.id } });
    return { opId: op.opId, status: "applied", row: row ?? undefined };
  }

  assertKnownFields(fields, CUSTOM_FIELD_DEF_UPDATE_FIELDS);
  const current = await prisma.customFieldDef.findFirst({
    where: { id: op.id, ownerId: userId },
  });
  if (!current) throw new AppError(404, "Custom field not found");

  const conflicts = conflictReceipts(
    op.baseUpdatedAt,
    current.updatedAt,
    fields,
    current as unknown as Record<string, unknown>,
  );

  await updateFieldDef(userId, op.id, {
    ...(fields.label !== undefined ? { label: fields.label as string } : {}),
    ...(fields.type !== undefined ? { type: fields.type as string } : {}),
    ...(fields.min !== undefined ? { min: fields.min as number | null } : {}),
    ...(fields.max !== undefined ? { max: fields.max as number | null } : {}),
    ...(fields.position !== undefined
      ? { position: fields.position as number }
      : {}),
    ...(parsePlaceTypeIds(fields.placeTypeIds) !== undefined
      ? { placeTypeIds: parsePlaceTypeIds(fields.placeTypeIds) }
      : {}),
    ...(fields.appliesToAllTypes !== undefined
      ? { appliesToAllTypes: Boolean(fields.appliesToAllTypes) }
      : {}),
  });

  const row = await prisma.customFieldDef.findUnique({ where: { id: op.id } });
  return {
    opId: op.opId,
    status: conflicts.length ? "appliedWithConflict" : "applied",
    row: row ?? undefined,
    ...(conflicts.length ? { conflicts } : {}),
  };
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
          case "place":
            result = await applyPlaceOp(user.id, op);
            break;
          case "tripLog":
            result = await applyTripOp(user.id, op);
            break;
          case "placeLink":
            result = await applyPlaceLinkOp(user.id, op);
            break;
          case "route":
            result = await applyRouteOp(user.id, op);
            break;
          case "notification":
            result = await applyNotificationOp(user.id, op);
            break;
          case "customFieldDef":
            result = await applyCustomFieldDefOp(user.id, op);
            break;
          case "placeType":
            result = await applyPlaceTypeOp(user.id, op);
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
