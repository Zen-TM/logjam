// Pure, apart from syncIssues.ts, so its tests in
// syncIssueDisplay.test.ts need no database.

/**
 * The refusal's status code, and the sentence the server wrote for the user
 * (shared/DESIGN.md §11), shown as it is. `sentence` is absent when the
 * stored error JSON provides only a developer's `message`, which is never loaded.
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
