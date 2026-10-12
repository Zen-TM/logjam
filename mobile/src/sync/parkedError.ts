// What a parked outbox row recorded of its refusal that a screen may show.
// Pure, apart from syncIssues.ts, so its test needs no database.

/**
 * The refusal's status code, and the sentence the server wrote for the user
 * (shared/DESIGN.md §11), shown as it is. `sentence` is absent for an op
 * parked before the server's words were user copy: such a row holds a
 * developer's `message` instead, which is never loaded.
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
