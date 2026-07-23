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
