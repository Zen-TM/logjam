// Classify a failed Cognito session refresh (pure — vitest-tested).
//
// Offline-session semantics (MOBILE_APP_PLAN Stage 1, load-bearing for every
// later stage): NEVER auto-sign-out on token expiry or network unreachability —
// that would brick the app mid-trip. Force re-auth only when the refresh was
// *actively rejected* by Cognito while online (revoked/disabled/password
// change). Everything else — airplane mode, flaky reception, server hiccup —
// is transient: keep the session, keep local data usable.

/** Cognito error names that mean "this refresh token is no longer accepted". */
const REJECTION_ERROR_NAMES = new Set([
  // Refresh token expired, revoked (global sign-out), or invalidated by a
  // password change.
  "NotAuthorizedException",
  // Account disabled or deleted server-side.
  "UserNotFoundException",
  // Password reset forced by an admin — sign-in required to proceed.
  "PasswordResetRequiredException",
  "UserDisabledException",
]);

export type SessionFailure = "rejected" | "transient";

export function classifySessionError(err: unknown): SessionFailure {
  if (err instanceof Error) {
    const name = (err as { code?: string }).code ?? err.name;
    if (REJECTION_ERROR_NAMES.has(name)) return "rejected";
  }
  // Deliberately fail-open to "transient": an unknown failure keeps the
  // session rather than kicking a user out mid-trip. The cost of a wrong
  // "transient" is a retried request; the cost of a wrong "rejected" is a
  // bricked app in a canyon.
  return "transient";
}
