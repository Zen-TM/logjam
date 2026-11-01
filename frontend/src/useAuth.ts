import { useState, useEffect, useCallback, useRef } from "react";
import { globalSignOut } from "@logjam/shared";
import { CURRENT_CONSENT_VERSION } from "./consent";
import {
  apiFetch,
  recordConsent,
  setSessionExpiredHandler,
} from "./placeUtils";
import { messageFromError } from "./errors/messageFromError";
import { clearTileCache } from "./geoPdf/cache";
import { clearTripDraft } from "./tripDraft";
import {
  completeSignInFromUrl,
  issuerUrl,
  loadSession,
  signInRedirect,
  signInWithPassword,
  endProviderSession,
} from "./auth/oidc";

// Calls GET /users/me after sign-in. The API creates a new user record
// if one doesn't exist yet (keyed on the token's sub), so this is safe
// to call on every sign-in, not just the first.
async function ensureUserExists() {
  await apiFetch("/users/me");
}

export type AuthState = "loading" | "signIn" | "authenticated";

// Cognito's answers about this person or this attempt, which the form shows.
// Anything else means the form cannot finish here (a flow the app client no
// longer allows, a forced password reset, a blocked request), so the provider's
// own page takes over.
const FORM_ANSWERS = new Set([
  "NotAuthorizedException",
  "UserNotConfirmedException",
  "UserNotFoundException",
  "LimitExceededException",
  "TooManyRequestsException",
]);

// Sign-out needs no hook state, so the account page and the consent gate call
// these directly instead of mounting a second useAuth (and its session check).
async function endSession() {
  // A trip draft is place names and notes in localStorage, readable by
  // anything on the origin and unaffected by the navigation below. It must
  // not outlive the session that wrote it: sign-out is the line (privacy
  // rules, root AGENTS.md). Cleared before the network call so a failure
  // can't strand it.
  clearTripDraft();
  // The GeoPDF tile cache shows which areas were printed: same line. It
  // clears here because the user is known to be signing out.
  await clearTileCache();
  // Leave unconditionally, matching RootErrorBoundary's flow: a rejection
  // would propagate into an onClick handler that ignores promises and leave the
  // UI looking signed in with the draft gone.
  let to: string | null = null;
  try {
    if (import.meta.env.VITE_AUTH_MODE !== "fake") {
      to = await endProviderSession();
    }
  } catch (err) {
    console.error(err);
  }
  // Once more: a render or prefetch worker may have written while the
  // sign-out was in flight. Before the navigation, which would abort it
  // (frontend/AGENTS.md, ADR 0043).
  await clearTileCache();
  if (to) window.location.assign(to);
  else window.location.reload();
}

export const signOut = endSession;

/**
 * Cognito only (hasCognitoAccount): GlobalSignOut revokes every refresh token
 * the user holds (ADR 0041). A stale access token or no reception must not
 * look like success while every other session lives on, so refresh first and
 * let either failure throw here, before anything is cleared.
 */
export async function signOutEverywhere() {
  if (import.meta.env.VITE_AUTH_MODE !== "fake") {
    const user = await loadSession(true);
    if (!user) throw new Error("No session to refresh");
    await globalSignOut(issuerUrl(), user.access_token);
  }
  await endSession();
}

export function useAuth() {
  // Fake auth (local dev, e2e) is signed in from the first render; a real
  // session is checked on mount below.
  const [state, setState] = useState<AuthState>(() =>
    import.meta.env.VITE_AUTH_MODE === "fake" ? "authenticated" : "loading",
  );
  const [error, setError] = useState<string | null>(null);

  // True when the session check itself failed (offline, say) and put the
  // sign-in screen up with the refresh token still in localStorage: the user
  // may be the same one, so their GeoPDF tiles stay (see the effect below).
  // Reset by the next successful sign-in, which clears the cache first.
  const sessionCheckFailed = useRef(false);

  const enterSession = useCallback(async () => {
    // Whoever signs in starts with an empty tile cache, even after a
    // failed session check that left the last user's in place.
    await clearTileCache();
    sessionCheckFailed.current = false;
    // Await provisioning before flipping to authenticated: GET /users/me
    // creates the User row on first login, and every other endpoint 404s
    // ("User not found") until that row exists. Flipping state first let
    // the boot-time data hooks race the insert and surface a burst of
    // error toasts on fresh accounts. Still best-effort: if the API is
    // unreachable we sign in anyway rather than blocking the user.
    await ensureUserExists().catch(console.error);
  }, []);

  // On mount: finish a sign-in the provider just sent the browser back from,
  // else check for an existing session in localStorage.
  useEffect(() => {
    if (import.meta.env.VITE_AUTH_MODE === "fake") return;
    let cancelled = false;
    (async () => {
      let signedInNow = false;
      try {
        signedInNow = (await completeSignInFromUrl()) !== null;
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        // Not known signed out: whoever was here may still hold a session.
        setError(messageFromError(err, "Sign in failed. Please try again."));
        sessionCheckFailed.current = true;
        setState("signIn");
        return;
      }
      if (cancelled) return;
      if (signedInNow) {
        await enterSession();
        if (!cancelled) setState("authenticated");
        return;
      }
      try {
        const user = await loadSession();
        if (cancelled) return;
        if (user) {
          setState("authenticated");
        } else {
          // Whoever was here last is signed out, however it came about (a
          // session that lapsed while the tab was shut): their GeoPDF tiles
          // go with it.
          void clearTileCache();
          setState("signIn");
        }
      } catch {
        if (cancelled) return;
        // Not known signed out: no clear here or after (sessionCheckFailed).
        sessionCheckFailed.current = true;
        setState("signIn");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enterSession]);

  // The sign-in screen showing means nobody is known to be signed in, so the
  // tile cache goes, except when the session check failed. This runs after the
  // dialog (and the workers it started) is gone, so it also covers a session
  // that expired mid-render.
  useEffect(() => {
    if (state === "signIn" && !sessionCheckFailed.current) {
      void clearTileCache();
    }
  }, [state]);

  // Listen for mid-session token-refresh failures from apiFetch. When the
  // refresh token has expired or been revoked, drop back to the sign-in
  // screen with an explanatory banner instead of leaving the UI in a
  // half-authenticated state where every request 401s silently.
  useEffect(() => {
    if (import.meta.env.VITE_AUTH_MODE === "fake") return;
    setSessionExpiredHandler(() => {
      void clearTileCache();
      setState((prev) => {
        if (prev !== "authenticated") return prev;
        setError("Your session has expired. Please sign in again.");
        return "signIn";
      });
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  // The provider's own page does the signing in; this only sends the browser
  // there. The page comes back to the mount effect above.
  const handleSignIn = useCallback(async () => {
    setError(null);
    try {
      await signInRedirect();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Sign in failed. Please try again."));
    }
  }, []);

  // Logjam Web's own forms (Cognito only). Throws what the form should show.
  // A new account's sign-up form has already asked for its username, the terms
  // and its age; if recording them fails, ConsentGate asks again.
  const handlePasswordSignIn = useCallback(
    async (email: string, password: string, newAccountUsername?: string) => {
      setError(null);
      let signedIn = false;
      try {
        signedIn = await signInWithPassword(email, password);
      } catch (err) {
        const answered = err instanceof Error && FORM_ANSWERS.has(err.name);
        if (answered || !navigator.onLine) throw err;
        console.error(err);
      }
      if (!signedIn) {
        await signInRedirect();
        return;
      }
      await enterSession();
      if (newAccountUsername) {
        await recordConsent(CURRENT_CONSENT_VERSION, newAccountUsername).catch(
          console.error,
        );
      }
      setState("authenticated");
    },
    [enterSession],
  );

  return {
    state,
    error,
    signIn: handleSignIn,
    signInWithPassword: handlePasswordSignIn,
  };
}
