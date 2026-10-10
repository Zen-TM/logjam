// Marks an error as "the request got no answer": a timeout, a reset
// connection, a reply cut off mid-body, a token refresh that could not reach
// Cognito. It says something about the link and nothing about what was sent,
// which is the one fact the sync engine needs before it counts a failure
// against an op (flush.ts) and the one an error's class cannot give it: fetch
// rejects with a bare TypeError, the abort with an AbortError, and the native
// upload task with whatever the platform threw.
//
// A mark rather than a wrapper class so every existing `catch` still sees the
// error it always saw.
const unanswered = new WeakSet<object>();

export function markNoResponse<T>(err: T): T {
  if (typeof err === "object" && err !== null) unanswered.add(err);
  return err;
}

export function isNoResponse(err: unknown): boolean {
  return typeof err === "object" && err !== null && unanswered.has(err);
}
