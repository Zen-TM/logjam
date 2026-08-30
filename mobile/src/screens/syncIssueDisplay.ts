// Copy for the Sync issues screen. Pure, and separate from the screen, because
// `previewValue` is a PRIVACY boundary (it decides which of a parked op's own
// field values may be drawn on screen) and a boundary with no test is a boundary
// that quietly stops holding.
import type { ParkedOp, ShelfEntry } from "../sync/syncIssues";

const ENTITY_LABEL: Record<string, string> = {
  canyon: "Canyon",
  tripLog: "Trip",
  waypoint: "Waypoint",
  notification: "Notification",
  // Media rides the outbox too, and a parked one is what the user is most likely
  // to meet here. "media — create" was the raw column values leaking through.
  media: "Attachment",
};

const OP_LABEL: Record<string, string> = {
  create: "create",
  update: "edit",
  delete: "delete",
  markRead: "mark read",
  markUnread: "mark unread",
};

// A media op's verbs are not the generic ones: you upload and remove a photo,
// you don't "create" one.
const MEDIA_OP_LABEL: Record<string, string> = {
  create: "upload",
  delete: "remove",
};

/**
 * Fields whose VALUE must never be rendered, whatever the op happens to carry.
 * A parked canyon create holds latitude/longitude, and this screen is exactly the
 * kind of page that ends up in a screenshot attached to a bug report — which is
 * the reason DESIGN.md §11 keeps coordinates off lists entirely.
 */
const UNRENDERABLE_FIELDS = new Set(["latitude", "longitude"]);

export function entityLabel(entity: string): string {
  return ENTITY_LABEL[entity] ?? entity;
}

export function opTitle(op: ParkedOp): string {
  // A name is user-supplied text and allowed; it is also the only way to tell two
  // parked entries apart. Media carries it as `filename`, everything else as
  // `name` — without the fallback, every stuck upload reads identically.
  const named = op.fields?.name ?? op.fields?.filename;
  const name = typeof named === "string" && named.length > 0 ? ` “${named}”` : "";
  const verb =
    (op.entity === "media" ? MEDIA_OP_LABEL[op.op] : undefined) ??
    OP_LABEL[op.op] ??
    op.op;
  return `${entityLabel(op.entity)}${name} — ${verb}`;
}

export function opCause(op: ParkedOp): string {
  if (op.state === "deadRemote") {
    return "The item was deleted elsewhere while you were editing it.";
  }
  // The server's rejection reason is a domain message we wrote server-side
  // (409 "This canyon already has a track"), which is worth showing. The
  // fallback covers anything that arrived without one.
  return op.error?.message ?? "The server rejected this change.";
}

/**
 * What discarding actually costs, per entity — because the two are different and
 * a confirm dialog that describes the wrong one is worse than a vague one.
 *
 * A synced entity's typing goes to the conflict shelf, so it is recoverable to
 * read. A media op's fields are bookkeeping and are NOT shelved; what it has
 * instead is a cached copy on the device, and discarding deletes that.
 */
export function discardExplanation(op: ParkedOp): string {
  if (op.entity === "media") {
    return "The copy waiting to upload is deleted from this phone. Whatever you picked it from is untouched.";
  }
  return "Your field data is kept in the conflict shelf, so you can still read what you had typed.";
}

export function shelfTitle(entry: ShelfEntry): string {
  return `${entityLabel(entry.entity)} · ${entry.field}`;
}

/** A shelved or parked field value, rendered for reading — never a coordinate. */
export function previewValue(field: string, value: unknown): string {
  if (UNRENDERABLE_FIELDS.has(field)) return "(hidden)";
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
