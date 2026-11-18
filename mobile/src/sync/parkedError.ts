// Pure, apart from syncIssues.ts, so its tests in
// syncIssueDisplay.test.ts need no database.

/**
 * Why a queued upload stopped, as saved on its outbox row (`error_json.reason`).
 * A code, not a sentence: no screen words it yet, and the Sync issues screen
 * words these rows from `code` alone (`opAdvice`).
 */
export type SyncErrorCode =
  | "storage_full"
  | "track_exists"
  | "rejected"
  | "file_missing"
  | "keeps_failing";

/**
 * The refusal's status code, and the sentence the server wrote for the user
 * (shared/DESIGN.md §11), shown as it is. `sentence` is absent when the
 * stored error JSON provides only a `reason` code, which is never loaded.
 */
export type ParkedError = { code: number; sentence?: string };

export function parkedError(errorJson: string): ParkedError {
  const { code, sentence } = JSON.parse(errorJson) as {
    code: number;
    sentence?: unknown;
  };
  return typeof sentence === "string" && sentence.length > 0
    ? { code, sentence }
    : { code };
}
