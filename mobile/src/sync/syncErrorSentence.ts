import { t } from "@logjam/shared";

/**
 * Why a queued upload stopped, as saved on its outbox row (`error_json.reason`).
 * A code, not a sentence: the sentence is written when it is shown, in the
 * language then in force. Guard: syncErrorSentence.test.ts.
 */
export type SyncErrorCode =
  | "storage_full"
  | "track_exists"
  | "rejected"
  | "file_missing"
  | "keeps_failing";

const CODES: readonly string[] = [
  "storage_full",
  "track_exists",
  "rejected",
  "file_missing",
  "keeps_failing",
] satisfies SyncErrorCode[];

// No default: a new code that has no sentence here fails the typecheck.
function sentenceFor(code: SyncErrorCode): string {
  switch (code) {
    case "storage_full":
      return t`Not enough storage space. Free some space and retry.`;
    case "track_exists":
      return t`This place already has a track. Remove it first.`;
    case "rejected":
      return t`The server rejected this upload.`;
    case "file_missing":
      return t`This file is no longer on this phone. Discard this upload.`;
    case "keeps_failing":
      return t`This upload keeps failing on this phone. Try again or discard it.`;
  }
}

/** The sentence for a stored reason. A value that is not a known code (a row
 *  written by an older build) is shown as it is. */
export function syncErrorSentence(stored: string): string {
  return CODES.includes(stored) ? sentenceFor(stored as SyncErrorCode) : stored;
}
