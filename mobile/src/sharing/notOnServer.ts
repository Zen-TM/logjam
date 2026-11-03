import { ApiError } from "@logjam/shared";

/** What a share answers when the account has no such row (ADR 0002: 404, not 403). */
export const NOT_IN_ACCOUNT_SENTENCE =
  "This isn't in your account yet. Sync, then try again.";

/**
 * A grant the sharer's own item 404s: the phone holds a row the server does
 * not, so syncing is the way out. The API's wording ("Couldn't find that
 * place.") names no next step.
 */
export function isNotInAccount(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}
