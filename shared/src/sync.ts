// Stage 8 sync protocol — shared vocabulary for the API and the mobile
// client (the TOPO_LAYERS-style single source; see .claude/mobile-plan/
// stage8-sync.md). PR-1 defines the tombstone entity vocabulary; the delta /
// push protocol types land with their endpoints.

/**
 * Entity types that participate in delta sync and therefore in the
 * per-user tombstone log. A tombstone row (userId, entityType, entityId)
 * means "that user must remove that entity from any local mirror".
 */
export const SYNC_ENTITY_TYPES = [
  "canyon",
  "tripLog",
  "media",
  "canyonShare",
  "friendship",
  "waypoint",
  "route",
] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

/**
 * Strict UUIDv4 shape — the only accepted form for client-minted entity ids
 * (§3.5: idempotency backbone). The mobile client mints with this shape and
 * the API rejects anything else with 400; both sides validate against this
 * single definition.
 */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_REGEX.test(value);
}

// ── Protocol constants (§4, §8, §10) ─────────────────────────────────────────

export const SYNC_PROTOCOL = 1;
export const SYNC_DELTA_DEFAULT_LIMIT = 500;
export const SYNC_DELTA_MAX_LIMIT = 1000;
export const SYNC_PUSH_MAX_OPS = 50;
/**
 * Watermark overlap: the next cursor's ts is serverTime − this, so rows
 * committed by transactions that started before the previous pull observed
 * its watermark are re-delivered (Postgres timestamps are transaction-start
 * times). Re-delivery is free — the client applies pages as idempotent
 * upserts.
 */
export const SYNC_OVERLAP_MS = 60_000;

/** The `changes` keys of a delta response, in the fixed budget-fill order
 * (§4.4). Order matters only for client convenience — canyons before the
 * trips that embed their names. */
export const DELTA_ENTITY_ORDER = [
  "canyons",
  "tripLogs",
  "waypoints",
  "routes",
  "media",
  "canyonShares",
  "friendships",
] as const;

export type DeltaEntityKey = (typeof DELTA_ENTITY_ORDER)[number];

/**
 * Per-page row cap for routes specifically, well under
 * SYNC_DELTA_DEFAULT_LIMIT. A route carries its whole geometry inline (up to
 * MAX_ROUTE_POINTS ≈ 20 KB), so the default 500-row budget would build a
 * ~10 MB page. Every other delta entity is a fixed-size row and keeps the
 * default.
 */
export const SYNC_DELTA_ROUTE_LIMIT = 50;

// ── Push op wire shape (§8.1) ────────────────────────────────────────────────

/** Entities the push endpoint accepts. Media is deliberately absent — the
 * three-phase presign flow owns media creation (§7.1).
 *
 * A notification has no create (the server raises them) and no update beyond
 * its read bit, so it carries three ops: the read bit in both directions and a
 * delete. `markRead` is NOT monotonic any more — `markUnread` exists — so the
 * pair is last-writer-wins and the enqueue planner supersedes rather than
 * dedups them (see planOutboxEnqueue). */
export const SYNC_PUSH_OPS_BY_ENTITY = {
  canyon: ["create", "update", "delete"],
  tripLog: ["create", "update", "delete"],
  waypoint: ["create", "update", "delete"],
  route: ["create", "update", "delete"],
  notification: ["markRead", "markUnread", "delete"],
} as const;

export type SyncPushEntity = keyof typeof SYNC_PUSH_OPS_BY_ENTITY;
export type SyncPushOpKind =
  (typeof SYNC_PUSH_OPS_BY_ENTITY)[SyncPushEntity][number];

export type SyncPushOp = {
  /** Client-minted, for result correlation only. */
  opId: string;
  entity: SyncPushEntity;
  op: SyncPushOpKind;
  /** Entity id (client-minted UUIDv4 for creates). */
  id: string;
  /** Updates only: server updatedAt the edit was based on — conflict
   * DETECTION only, never resolution (§6). */
  baseUpdatedAt?: string;
  /** Create: full payload; update: dirty fields only. */
  fields?: Record<string, unknown>;
};

export type SyncPushOpStatus =
  | "applied"
  | "appliedWithConflict"
  | "alreadyApplied"
  | "rejected"
  | "dependencyFailed";

export type SyncConflictReceipt = { field: string; serverValue: unknown };

export type SyncPushOpResult = {
  opId: string;
  status: SyncPushOpStatus;
  row?: unknown;
  conflicts?: SyncConflictReceipt[];
  error?: { code: number; message: string };
};

export type SyncPushResponse = {
  serverTime: string;
  results: SyncPushOpResult[];
};

/**
 * Ids this op depends on having been created successfully (earlier in the
 * batch, or already server-side): its own target for update/delete, plus any
 * canyon references in its fields. Both ends use it — the server for
 * dependencyFailed propagation, the client for the flush engine's
 * dependency-closure skip (§8.3).
 */
export function pushOpDependencies(op: SyncPushOp): string[] {
  const deps: string[] = [];
  if (op.op === "update" || op.op === "delete") deps.push(op.id);
  const canyonIds = op.fields?.canyonIds;
  if (Array.isArray(canyonIds)) {
    deps.push(...canyonIds.filter((v): v is string => typeof v === "string"));
  }
  const canyonId = op.fields?.canyonId;
  if (typeof canyonId === "string") deps.push(canyonId);
  return deps;
}

// ── Delta wire shapes (§4.1) ─────────────────────────────────────────────────
//
// Client-side view of the delta serializers in api/src/routes/sync.ts —
// dates arrive as ISO strings. The server builds these from Prisma rows, so
// the shapes are mirrored here, not imported there; syncBoundary.test.ts
// (integration) is the drift guard. Additive-only on protocol 1 (§10.3):
// clients must tolerate unknown extra keys (preserved via extra_json in the
// mobile mirror, never round-tripped).

export type SyncUserRef = { id: string; username: string };

export type SyncDeltaCanyonRow = {
  id: string;
  ownerId: string;
  /** 'owner' | 'shared' — the caller's relationship to the row. */
  syncRole: "owner" | "shared";
  name: string;
  altNames: string[];
  latitude: number;
  longitude: number;
  numAbseils: number | null;
  longestAbseil: number | null;
  vGrade: number | null;
  aGrade: number | null;
  commitment: number | null;
  quality: number | null;
  hours: number | null;
  notes: string | null;
  attributes: Record<string, unknown>;
  ropeWikiId: number | null;
  forkedFromId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncDeltaTripRow = {
  id: string;
  userId: string;
  date: string;
  displayName: string | null;
  types: string[];
  notes: string | null;
  customFields: Record<string, unknown>;
  /** Ordered — order drives the derived title (shared/src/tripName.ts). */
  canyons: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
};

export type SyncDeltaWaypointRow = {
  id: string;
  ownerId: string;
  /**
   * Mirrors SyncDeltaCanyonRow: 'shared' means the row arrives only because it
   * is linked to a canyon shared with the caller, and is READ-ONLY there.
   */
  syncRole: "owner" | "shared";
  /**
   * Every canyon this waypoint is linked to THAT THE CALLER CAN SEE. A sharee
   * never learns that an owner also filed the carpark under three canyons they
   * were not shared on, so this list is scoped, not the raw link set.
   */
  canyonIds: string[];
  name: string;
  latitude: number;
  longitude: number;
  elevation: number | null;
  symbol: string | null;
  notes: string | null;
  tags: string[];
  /**
   * How many people this waypoint is directly shared with.
   *
   * OWNER ROWS ONLY. A share fan-out is owner-private derived cardinality
   * (root CLAUDE.md): a recipient must not learn how many OTHER people hold
   * the thing they were given. Optional rather than `number` for a second
   * reason — the write paths return a row without it, where absent means
   * "unchanged", not zero.
   */
  sharedCount?: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * A user-authored route. Unlike media, the geometry travels INLINE — a route
 * is a vertex list on the row, not a blob behind a presigned URL.
 *
 * `syncRole` mirrors SyncDeltaCanyonRow: 'shared' means the row arrives only
 * because it is LINKED to a canyon shared with the caller. A sharee may render
 * and export it, never edit it — and unlinking it revokes their copy via a
 * tombstone with no delete anywhere.
 */
export type SyncDeltaRouteRow = {
  id: string;
  ownerId: string;
  syncRole: "owner" | "shared";
  canyonId: string | null;
  name: string;
  color: string;
  /** [[lon, lat], ...] — see MAX_ROUTE_POINTS in routeValidation.ts. */
  points: [number, number][];
  /**
   * Indices into `points` marking the vertices the USER placed, as opposed to
   * those snapping filled in. Null on routes drawn before snapping existed,
   * which reads as "every point is the user's".
   */
  anchors: number[] | null;
  /** Owner rows only — see SyncDeltaWaypointRow.sharedCount. */
  sharedCount?: number;
  createdAt: string;
  updatedAt: string;
};

/** Metadata only — blobs come via POST /media/download-urls (§7.3). */
export type SyncDeltaMediaRow = {
  id: string;
  linkedType: string;
  linkedId: string;
  mediaType: string;
  filename: string | null;
  fileSizeBytes: string;
  color: string | null;
  createdAt: string;
};

export type SyncDeltaShareRow = {
  id: string;
  canyonId: string;
  sharedById: string;
  sharedWithId: string;
  createdAt: string;
  sharedBy: SyncUserRef;
  sharedWith: SyncUserRef;
};

export type SyncDeltaFriendshipRow = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  counterpart: SyncUserRef;
  direction: "sent" | "received";
};

export type SyncDeltaTombstone = { type: SyncEntityType; id: string };

export type SyncDeltaResponse = {
  protocol: number;
  epoch: number;
  serverTime: string;
  cursor: string;
  hasMore: boolean;
  resetRequired: boolean;
  changes: {
    canyons: SyncDeltaCanyonRow[];
    tripLogs: SyncDeltaTripRow[];
    waypoints: SyncDeltaWaypointRow[];
    routes: SyncDeltaRouteRow[];
    media: SyncDeltaMediaRow[];
    canyonShares: SyncDeltaShareRow[];
    friendships: SyncDeltaFriendshipRow[];
  };
  tombstones: SyncDeltaTombstone[];
};

// ── Delta row validation (trust boundary) ────────────────────────────────────
//
// The rows above are a hand-mirrored view of what the server sends: TypeScript
// asserts nothing at runtime, so a renamed or newly-nullable field lands in a
// client's local mirror as corruption that no compiler ever saw. These parsers
// are the boundary check — call them before writing a server row into local
// storage. They throw rather than coerce: a mirror is a rebuildable cache, so
// failing the apply and re-pulling is always cheaper than storing junk.
//
// PRIVACY: messages name FIELDS ONLY, never values — a row carries canyon
// names and coordinates and these messages reach logs.
// Unknown extra keys are ALLOWED (protocol §10.3 is additive-only).

export class SyncRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncRowError";
  }
}

type FieldCheck = (value: unknown) => boolean;

const isString: FieldCheck = (value) => typeof value === "string";
const isNumber: FieldCheck = (value) =>
  typeof value === "number" && Number.isFinite(value);
const isPlainObject: FieldCheck = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isSyncRole: FieldCheck = (value) =>
  value === "owner" || value === "shared";
const nullable =
  (check: FieldCheck): FieldCheck =>
  (value) =>
    value === null || check(value);
const arrayOf =
  (check: FieldCheck): FieldCheck =>
  (value) =>
    Array.isArray(value) && value.every(check);
const isCanyonRef: FieldCheck = (value) =>
  isPlainObject(value) &&
  isString((value as Record<string, unknown>).id) &&
  isString((value as Record<string, unknown>).name);

const CANYON_ROW_SPEC: Record<string, FieldCheck> = {
  id: isString,
  ownerId: isString,
  syncRole: isSyncRole,
  name: isString,
  altNames: arrayOf(isString),
  latitude: isNumber,
  longitude: isNumber,
  numAbseils: nullable(isNumber),
  longestAbseil: nullable(isNumber),
  vGrade: nullable(isNumber),
  aGrade: nullable(isNumber),
  commitment: nullable(isNumber),
  quality: nullable(isNumber),
  hours: nullable(isNumber),
  notes: nullable(isString),
  attributes: isPlainObject,
  ropeWikiId: nullable(isNumber),
  forkedFromId: nullable(isString),
  createdAt: isString,
  updatedAt: isString,
};

const TRIP_ROW_SPEC: Record<string, FieldCheck> = {
  id: isString,
  userId: isString,
  date: isString,
  displayName: nullable(isString),
  types: arrayOf(isString),
  notes: nullable(isString),
  customFields: isPlainObject,
  canyons: arrayOf(isCanyonRef),
  createdAt: isString,
  updatedAt: isString,
};

const WAYPOINT_ROW_SPEC: Record<string, FieldCheck> = {
  id: isString,
  ownerId: isString,
  syncRole: isSyncRole,
  canyonIds: arrayOf(isString),
  name: isString,
  latitude: isNumber,
  longitude: isNumber,
  elevation: nullable(isNumber),
  symbol: nullable(isString),
  notes: nullable(isString),
  tags: arrayOf(isString),
  createdAt: isString,
  updatedAt: isString,
};

const isUserRef: FieldCheck = (value) =>
  isPlainObject(value) &&
  isString((value as Record<string, unknown>).id) &&
  isString((value as Record<string, unknown>).username);

/** A [lon, lat] pair — the shape every route point must have to be drawable. */
const isLonLatPair: FieldCheck = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(isNumber);

const ROUTE_ROW_SPEC: Record<string, FieldCheck> = {
  id: isString,
  ownerId: isString,
  syncRole: isSyncRole,
  canyonId: nullable(isString),
  name: isString,
  color: isString,
  points: arrayOf(isLonLatPair),
  anchors: nullable(arrayOf(isNumber)),
  createdAt: isString,
  updatedAt: isString,
};

const MEDIA_ROW_SPEC: Record<string, FieldCheck> = {
  id: isString,
  linkedType: isString,
  linkedId: isString,
  mediaType: isString,
  filename: nullable(isString),
  // A string, not a number: it is a BigInt on the server and JSON-encoded as
  // text so it survives the round trip.
  fileSizeBytes: isString,
  color: nullable(isString),
  createdAt: isString,
};

const SHARE_ROW_SPEC: Record<string, FieldCheck> = {
  id: isString,
  canyonId: isString,
  sharedById: isString,
  sharedWithId: isString,
  createdAt: isString,
  sharedBy: isUserRef,
  sharedWith: isUserRef,
};

const FRIENDSHIP_ROW_SPEC: Record<string, FieldCheck> = {
  id: isString,
  status: isString,
  createdAt: isString,
  updatedAt: isString,
  counterpart: isUserRef,
  direction: (value) => value === "sent" || value === "received",
};

function parseRow<Row>(
  entity: string,
  value: unknown,
  spec: Record<string, FieldCheck>,
): Row {
  if (!isPlainObject(value)) {
    throw new SyncRowError(`sync ${entity} row is not an object`);
  }
  const row = value as Record<string, unknown>;
  const bad = Object.keys(spec).filter((field) => !spec[field](row[field]));
  if (bad.length > 0) {
    throw new SyncRowError(
      `sync ${entity} row has missing or invalid fields: ${bad.join(", ")}`,
    );
  }
  return value as Row;
}

export function parseSyncDeltaCanyonRow(value: unknown): SyncDeltaCanyonRow {
  return parseRow<SyncDeltaCanyonRow>("canyon", value, CANYON_ROW_SPEC);
}

export function parseSyncDeltaTripRow(value: unknown): SyncDeltaTripRow {
  return parseRow<SyncDeltaTripRow>("tripLog", value, TRIP_ROW_SPEC);
}

export function parseSyncDeltaWaypointRow(value: unknown): SyncDeltaWaypointRow {
  return parseRow<SyncDeltaWaypointRow>("waypoint", value, WAYPOINT_ROW_SPEC);
}

export function parseSyncDeltaRouteRow(value: unknown): SyncDeltaRouteRow {
  return parseRow<SyncDeltaRouteRow>("route", value, ROUTE_ROW_SPEC);
}

export function parseSyncDeltaMediaRow(value: unknown): SyncDeltaMediaRow {
  return parseRow<SyncDeltaMediaRow>("media", value, MEDIA_ROW_SPEC);
}

export function parseSyncDeltaShareRow(value: unknown): SyncDeltaShareRow {
  return parseRow<SyncDeltaShareRow>("canyonShare", value, SHARE_ROW_SPEC);
}

export function parseSyncDeltaFriendshipRow(
  value: unknown,
): SyncDeltaFriendshipRow {
  return parseRow<SyncDeltaFriendshipRow>(
    "friendship",
    value,
    FRIENDSHIP_ROW_SPEC,
  );
}

/**
 * A tombstone names a row to delete, so a malformed one is as dangerous as a
 * malformed row — `type` decides WHICH table the delete cascades through.
 */
export function parseSyncDeltaTombstone(value: unknown): SyncDeltaTombstone {
  return parseRow<SyncDeltaTombstone>("tombstone", value, {
    type: (v) => SYNC_ENTITY_TYPES.includes(v as SyncEntityType),
    id: isString,
  });
}

// ── Cursor codec (§4.2) ──────────────────────────────────────────────────────
//
// The cursor is server-minted and opaque to the client (stored + returned
// verbatim), but the codec lives in shared/ because it is pure, unit-tested,
// and §11 puts the protocol's TypeScript in one place. Unsigned by design:
// the delta query is per-user scoped server-side regardless of cursor
// contents, so tampering can only change which of your own rows re-download.

/** Per-entity keyset resume point: [watermark ISO, last id]. `tombstones` is
 * a pseudo-entity key used when a page ends inside the tombstone list. */
export type SyncCursorKeysets = Partial<
  Record<DeltaEntityKey | "tombstones", [string, string]>
>;

export type SyncCursor = {
  /** Cursor format version — mismatch forces resetRequired. */
  v: number;
  /** Watermark: entities changed strictly after this ISO instant. */
  ts: string;
  /** Server epoch the cursor was minted under (defaults to 1 when absent) —
   * mismatch with the server's current epoch forces resetRequired (§10.5). */
  e?: number;
  /** Present only mid-pagination (hasMore pages). */
  k?: SyncCursorKeysets;
};

// Hand-rolled base64url over ASCII (cursor JSON is ASCII by construction:
// ISO timestamps, UUIDs, entity keys). No Buffer/btoa dependency — this file
// runs in Node and React Native Hermes alike.
const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlEncode(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 3) {
    const c1 = input.charCodeAt(i);
    const c2 = i + 1 < input.length ? input.charCodeAt(i + 1) : NaN;
    const c3 = i + 2 < input.length ? input.charCodeAt(i + 2) : NaN;
    out += B64_ALPHABET[c1 >> 2];
    out += B64_ALPHABET[((c1 & 3) << 4) | (Number.isNaN(c2) ? 0 : c2 >> 4)];
    if (!Number.isNaN(c2)) {
      out += B64_ALPHABET[((c2 & 15) << 2) | (Number.isNaN(c3) ? 0 : c3 >> 6)];
    }
    if (!Number.isNaN(c3)) out += B64_ALPHABET[c3 & 63];
  }
  return out; // unpadded, per base64url convention
}

function base64UrlDecode(input: string): string | null {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const char of input) {
    const value = B64_ALPHABET.indexOf(char);
    if (value === -1) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

export function encodeSyncCursor(cursor: SyncCursor): string {
  return base64UrlEncode(JSON.stringify(cursor));
}

/**
 * Decode + validate a cursor string. Returns null on ANY malformation —
 * the server treats null as resetRequired (§4.3), never as an error.
 */
export function decodeSyncCursor(value: string): SyncCursor | null {
  const json = base64UrlDecode(value);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { v, ts, e, k } = parsed as {
    v?: unknown;
    ts?: unknown;
    e?: unknown;
    k?: unknown;
  };
  if (typeof v !== "number") return null;
  if (typeof ts !== "string" || Number.isNaN(Date.parse(ts))) return null;
  if (e !== undefined && typeof e !== "number") return null;
  if (k !== undefined) {
    if (typeof k !== "object" || k === null || Array.isArray(k)) return null;
    for (const entry of Object.values(k as Record<string, unknown>)) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        typeof entry[1] !== "string" ||
        Number.isNaN(Date.parse(entry[0]))
      ) {
        return null;
      }
    }
  }
  return {
    v,
    ts,
    ...(e !== undefined && { e }),
    ...(k !== undefined && { k: k as SyncCursorKeysets }),
  };
}
