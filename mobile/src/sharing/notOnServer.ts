import { ApiError } from "@logjam/shared";
import { unavailableReasonText } from "../auth/capabilities";

/**
 * What a grant that the API 404s means for the sharer's own item (ADR 0002:
 * 404, not 403). If this phone still holds the row, the account has not
 * received it yet and syncing is the way out, in the wording the sheet already
 * uses for that state. If the mirror no longer holds it, it was deleted
 * elsewhere and a sync would only confirm that. Null for any other failure.
 */
export function shareGrantNotFound(
  err: unknown,
  stillHeld: boolean,
): { message: string; syncFixes: boolean } | null {
  if (!(err instanceof ApiError) || err.status !== 404) return null;
  return stillHeld
    ? { message: `${unavailableReasonText("needs-upload")}.`, syncFixes: true }
    : { message: "This was deleted.", syncFixes: false };
}
