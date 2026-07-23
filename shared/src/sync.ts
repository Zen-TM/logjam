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
