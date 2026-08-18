// The one way this app asks Amplify for a session.
//
// `fetchAuthSession` has no timeout of its own, and on a flaky link its
// connect neither succeeds nor fails — the same failure `apiFetch` already
// documents and guards for OUR requests ("observed on hardware (Pixel 9,
// airplane mode) where a connect() neither succeeds nor fails"). Unguarded it
// hangs two things that matter in a canyon:
//
//  - `useAuth`'s mount effect, which leaves `App` rendering its loading screen
//    for as long as the call takes — the "stuck on the logo screen" a cold
//    start produced in the field.
//  - `getIdToken`, which runs BEFORE `apiFetch`'s own 15 s timeout, so that
//    documented guarantee did not actually hold for any request.
//
// A timeout here is safe by the offline-session rules: `classifySessionError`
// maps an unknown failure to "transient", so a timed-out refresh keeps the
// session and keeps local data usable. It is the opposite that would be
// dangerous.
//
// Amplify exposes no abort, so the underlying request is abandoned rather than
// cancelled. That is fine — nothing awaits it, and the next call re-asks.
import { fetchAuthSession, type AuthSession } from "aws-amplify/auth";

/** Matches `apiFetch`'s REQUEST_TIMEOUT_MS: same link, same patience. */
export const SESSION_TIMEOUT_MS = 15_000;

export class AuthSessionTimeoutError extends Error {
  constructor() {
    super("Timed out asking for the auth session");
    this.name = "AuthSessionTimeoutError";
  }
}

/**
 * `fetchAuthSession` that always settles. Rejects with
 * `AuthSessionTimeoutError` (classified "transient") rather than hanging.
 */
export function fetchAuthSessionWithTimeout(): Promise<AuthSession> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new AuthSessionTimeoutError()), SESSION_TIMEOUT_MS);
  });
  return Promise.race([fetchAuthSession(), timeout]).finally(() =>
    clearTimeout(timer),
  );
}
