// Optional client-minted entity ids on create (Stage 8 §3.5 — the outbox
// idempotency backbone). Accepting the id at create time removes ALL
// id-remapping from the mobile outbox: references between queued ops
// (linkedId, canyonIds) are final at enqueue time.
//
// Uniform rules, every accepting route:
// - absent → server mints as before;
// - present but not a strict UUIDv4 → 400;
// - present and a row with that id exists: owned by the caller → the route
//   returns the existing row with 200 (idempotent replay, the pattern
//   media-confirm already implements); owned by anyone else → 404 — NOT
//   403/409, which would be an existence oracle for foreign ids (SEC-001).
//   A genuine cross-user v4 collision is cryptographically negligible;
//   treat it as an attack.
import { isUuidV4 } from "@logjam/shared";
import { AppError } from "../middleware/errorHandler";

/**
 * Parse an optional client-supplied id from a request body. Returns the id,
 * or undefined when absent (server mints). Throws 400 on anything else.
 */
export function parseClientSuppliedId(
  value: unknown,
  fieldName = "id",
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isUuidV4(value)) {
    throw new AppError(400, `${fieldName} must be a UUIDv4`);
  }
  return value;
}

/**
 * The replay-or-reject decision for a row that already carries a
 * client-supplied id: caller's own → replay (route returns it with 200);
 * anyone else's → 404 (anti-oracle, message identical to the route's
 * not-found path).
 */
export function assertClientIdReplayable(
  rowOwnerId: string,
  callerId: string,
  notFoundMessage: string,
): void {
  if (rowOwnerId !== callerId) throw new AppError(404, notFoundMessage);
}
