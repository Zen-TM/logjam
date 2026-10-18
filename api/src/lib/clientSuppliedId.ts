// Optional client-minted entity ids on create (the outbox idempotency
// backbone). Accepting the id at create time removes ALL id-remapping from
// the mobile outbox: references between queued ops (linkedId, placeIds) are
// final at enqueue time.
//
// Uniform rules, every accepting route:
// - absent → server mints as before;
// - present but not a strict UUIDv4 → 400;
// - present and a row with that id exists: owned by the caller → the route
//   returns the existing row with 200 (idempotent replay, the pattern
//   media-confirm already implements); owned by anyone else → 404 — NOT
//   403/409, which would be an existence oracle for foreign ids.
//   A genuine cross-user v4 collision is cryptographically negligible;
//   treat it as an attack.
import { isUuidV4, type UserSentence } from "@logjam/shared";
import { AppError, malformed } from "../middleware/errorHandler";

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
    throw malformed(`${fieldName} must be a UUIDv4`);
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
  // Null for a plan's row, which is nobody's: always the 404.
  rowOwnerId: string | null,
  callerId: string,
  notFoundMessage: UserSentence,
): void {
  if (rowOwnerId !== callerId) throw new AppError(404, notFoundMessage);
}
