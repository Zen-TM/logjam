// Outbox entity → its mirror table, and the entity type the OUTBOX actually
// holds (which is not the same as the sync protocol's).
//
// This exists as its own pure module because getting it wrong is silent: the
// mapping is only used to clean up after a discarded create, inside a
// transaction, so an entity that falls off the end produces `DELETE FROM
// undefined`, an exception, a rolled-back transaction — and a "Discard" button
// with no visible effect whatsoever. That was the bug (media rows are parked
// like any other, and `media` is deliberately absent from
// SYNC_PUSH_OPS_BY_ENTITY). The test asserts totality so a new entity can't
// reintroduce it.
import { SYNC_PUSH_OPS_BY_ENTITY, type SyncPushEntity } from "@logjam/shared";

/**
 * Everything the outbox can hold: the sync-protocol entities PLUS `media`, which
 * rides the same queue but runs its own three-phase presign→PUT→confirm flow
 * instead of the generic push (see `flushMediaOps`).
 */
export type OutboxEntity = SyncPushEntity | "media";

export const OUTBOX_ENTITIES: OutboxEntity[] = [
  ...(Object.keys(SYNC_PUSH_OPS_BY_ENTITY) as SyncPushEntity[]),
  "media",
];

export function isOutboxEntity(value: string): value is OutboxEntity {
  return (OUTBOX_ENTITIES as string[]).includes(value);
}

/**
 * The mirror table whose row an abandoned CREATE would orphan, or null when
 * there is nothing keyed by that id to delete.
 *
 * `notification` is null deliberately: `notifications_cache` has no `id` column,
 * so a delete keyed on one would throw — and a notification create is not a
 * thing the client ever enqueues. Returning null says that in a way the caller
 * has to handle, rather than relying on it never happening.
 */
export function outboxMirrorTable(entity: OutboxEntity): string | null {
  switch (entity) {
    case "canyon":
      return "canyons";
    case "tripLog":
      return "trip_logs";
    case "waypoint":
      return "waypoints";
    case "media":
      return "media";
    case "notification":
      return null;
  }
}

/**
 * Whether a discarded op's field values are worth keeping on the conflict shelf.
 *
 * For the synced entities they are the user's typing — the whole point of the
 * shelf. A media op's "fields" are a filename, a byte count and two cache paths:
 * nothing a person could want back, and the paths are about to be deleted.
 */
export function shelvesDiscardedFields(entity: OutboxEntity): boolean {
  return entity !== "media";
}
