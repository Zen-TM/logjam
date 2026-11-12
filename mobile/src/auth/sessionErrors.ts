// Classify a failed session refresh (pure — vitest-tested).
//
// Offline-session semantics: NEVER auto-sign-out on token expiry or network
// unreachability — that would brick the app mid-trip. Force re-auth only when
// the refresh was *actively rejected* by the provider while online
// (revoked/disabled). Everything else — airplane mode, flaky reception, server
// hiccup — is transient: keep the session, keep local data
// usable (Guard: sessionErrors.test.ts).

/**
 * The OAuth error code of a refresh the provider answered with "this refresh
 * token is no longer valid": expired, revoked by a sign-out everywhere, or the
 * user disabled or deleted. A password change does not revoke one.
 * `oidcSession.ts` names its error this when the token endpoint answers HTTP
 * 400 `{"error":"invalid_grant"}`, and for nothing else.
 */
export const REFRESH_REJECTED = "invalid_grant";

const REJECTION_ERROR_NAMES = new Set([REFRESH_REJECTED]);

export type SessionFailure = "rejected" | "transient";

export function classifySessionError(err: unknown): SessionFailure {
  if (err instanceof Error) {
    const name = (err as { code?: string }).code ?? err.name;
    if (REJECTION_ERROR_NAMES.has(name)) return "rejected";
  }
  // Deliberately fail-open to "transient": an unknown failure keeps the
  // session rather than kicking a user out mid-trip. The cost of a wrong
  // "transient" is a retried request; the cost of a wrong "rejected" is a
  // bricked app in a place.
  return "transient";
}
