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
  "media",
  "canyonShares",
  "friendships",
] as const;

export type DeltaEntityKey = (typeof DELTA_ENTITY_ORDER)[number];

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
