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
};

const OP_LABEL: Record<string, string> = {
  create: "create",
  update: "edit",
  delete: "delete",
  markRead: "mark read",
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
  // A name is user-supplied text and allowed; it is also the only way to tell
  // two parked canyon edits apart.
  const name = typeof op.fields?.name === "string" ? ` “${op.fields.name}”` : "";
  return `${entityLabel(op.entity)}${name} — ${OP_LABEL[op.op] ?? op.op}`;
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
