// Cognito auth hook — port of the web frontend/src/useAuth.ts with the mobile
// offline-session semantics from MOBILE_APP_PLAN Stage 1:
//
//  - Auth gates the API, not local data. After first successful login the
//    local identity (sub/username) persists; the app cold-starts into that
//    account with zero network.
//  - NEVER auto-sign-out on token expiry or unreachability. Re-auth is forced
//    only when Cognito actively rejects the refresh while online
//    (setSessionRejectedHandler ← classifySessionError).
//  - Tokens refresh proactively on app-foreground-while-online so a trip
//    starts with a fresh runway.
//  - Local data is wiped on explicit sign-out or when a DIFFERENT user signs
//    in; same-user re-login keeps it.
//
// Guest mode adds two states ahead of the account states. A fresh install with
// no recorded choice lands on `chooser`; picking "continue without an account"
// lands on `guest`, where the whole app runs against local storage and the sync
// engine is never started. `accountState` is what the UI gates on — see
// `capabilities.ts`.
//
// **A guest linking an account is not a user switch.** A guest never writes a
// local identity, so the different-user comparison below sees `previous ===
// null` and keeps their data, which then flushes up through the ordinary
// outbox. That is the whole linking mechanism; there is no separate import
// path.
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import {
  confirmResetPassword as amplifyConfirmResetPassword,
  confirmSignUp as amplifyConfirmSignUp,
  fetchAuthSession,
  resendSignUpCode as amplifyResendSignUpCode,
  resetPassword as amplifyResetPassword,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  signUp as amplifySignUp,
} from "aws-amplify/auth";
import { mapAuthNextStep, messageFromError } from "@logjam/shared";

import { config } from "../config";
import { apiFetch, setSessionRejectedHandler } from "../api/apiFetch";
import { grandfatherCrashReports } from "../sentry/initSentry";
import { wipeAllLocalData } from "../offline/wipeLocalData";
import { classifySessionError } from "./sessionErrors";
import type { AccountState } from "./capabilities";
import {
  clearEntryChoice,
  readEntryChoice,
  writeEntryChoice,
} from "./guestModePreference";
import {
  clearLocalIdentity,
  readLocalIdentity,
  writeLocalIdentity,
} from "./localIdentity";

// GET /users/me creates the user row on first login (keyed on the Cognito
// sub) — safe to call on every sign-in. Same rationale as web.
async function ensureUserExists(): Promise<void> {
  await apiFetch("/users/me");
}

function decodeSubFromIdToken(token: string): string | null {
  try {
    const payload = JSON.parse(
      // atob is available in Hermes; JWT payload is base64url.
      globalThis.atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export type AuthState =
  | "loading"
  /** Fresh install, nothing chosen: sign in, or continue without an account. */
  | "chooser"
  /** No account by choice. The app runs; server-backed features are gated. */
  | "guest"
  | "signIn"
  | "signUp"
  | "confirmSignUp"
  | "forgotPassword"
  | "confirmForgotPassword"
  | "authenticated";

/** The two states that mount the real app shell. */
export function mountsAppShell(state: AuthState): boolean {
  return state === "authenticated" || state === "guest";
}

export function useAuth() {
  const [state, setState] = useState<AuthState>("loading");
  const [error, setError] = useState<string | null>(null);
  // Username held between sign-up and confirmation steps
  const [pendingUsername, setPendingUsername] = useState("");

  // On mount: restore the session. Offline with a persisted identity still
  // lands in "authenticated" — an expired token is irrelevant until a request
  // needs it (offline-first rule).
  useEffect(() => {
    if (config.authMode === "fake") {
      setState("authenticated");
      return;
    }
    // A recorded guest choice short-circuits every network and Keychain call
    // below: a guest has no session to restore, and asking Cognito about one
    // would put a timeout between them and their own local data.
    const entryChoice = readEntryChoice();
    if (entryChoice === "guest") {
      setState("guest");
      return;
    }
    // Fresh install with nothing chosen — offer the choice before the sign-in
    // form, which is otherwise a wall in front of an app that mostly doesn't
    // need an account.
    const signedOutState: AuthState =
      entryChoice === "account" ? "signIn" : "chooser";

    let cancelled = false;
    (async () => {
      const localIdentity = await readLocalIdentity().catch(() => null);
      // Someone already signed in predates the crash-report toggle; fill their
      // absent preference rather than silently turning the reporter off.
      if (localIdentity) grandfatherCrashReports();
      try {
        const session = await fetchAuthSession();
        if (cancelled) return;
        if (session.tokens?.idToken) {
          setState("authenticated");
        } else {
          // No session in the store at all — genuinely signed out.
          setState(signedOutState);
        }
      } catch (err) {
        if (cancelled) return;
        if (classifySessionError(err) === "transient" && localIdentity) {
          // Offline/unreachable with a known local user: stay signed in
          // against local data; the API layer re-raises per-request.
          setState("authenticated");
        } else {
          setState(signedOutState);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Session actively rejected mid-use (revoked / password changed / disabled):
  // drop to sign-in with a banner. Local data is NOT wiped — the same user
  // re-authenticating keeps it.
  useEffect(() => {
    if (config.authMode === "fake") return;
    setSessionRejectedHandler(() => {
      setState((prev) => {
        if (prev !== "authenticated") return prev;
        setError("Your session has expired. Please sign in again.");
        return "signIn";
      });
    });
    return () => setSessionRejectedHandler(null);
  }, []);

  // Proactive refresh on app foreground so a trip starts with a fresh token
  // runway. Best-effort: a transient failure here is silent by design (the
  // whole point is not to disturb an offline session).
  useEffect(() => {
    if (config.authMode === "fake") return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        fetchAuthSession().catch((err: unknown) => {
          if (classifySessionError(err) === "rejected") {
            setState((prev) => {
              if (prev !== "authenticated") return prev;
              setError("Your session has expired. Please sign in again.");
              return "signIn";
            });
          }
        });
      }
    });
    return () => subscription.remove();
  }, []);

  const handleSignIn = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      setError(null);
      try {
        const result = await amplifySignIn({ username, password });
        if (!result.isSignedIn) {
          setError(mapAuthNextStep(result.nextStep.signInStep));
          return false;
        }
        // Persist the local identity for offline cold-starts. A DIFFERENT
        // user signing in wipes prior local data first.
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken?.toString();
        const sub = idToken ? decodeSubFromIdToken(idToken) : null;
        if (sub) {
          const previous = await readLocalIdentity().catch(() => null);
          if (previous && previous.sub !== sub) {
            // Someone else's canyons, tracks, photos and downloaded regions
            // must not be visible to — or flushed under the token of — the
            // account now signing in. Everything goes before the new identity
            // lands. Note a GUEST reaches here with `previous === null` and is
            // therefore untouched: linking keeps the local data, by design.
            const wiped = await wipeAllLocalData();
            if (wiped.failed.length > 0) {
              // Fail loudly rather than sign in over a half-cleared device:
              // the alternative is silently merging two people's data.
              //
              // Amplify has ALREADY signed in by this point, so backing out
              // means revoking that session too. Without this, the next cold
              // start finds a valid session, no new local identity, and lands
              // the new user straight in the old user's data — the exact leak
              // this branch exists to prevent.
              await amplifySignOut().catch(console.error);
              setError(
                `Couldn't clear the previous account's ${wiped.failed.join(" and ")} from this phone. Sign-in stopped so the two accounts don't mix.`,
              );
              return false;
            }
            await clearLocalIdentity();
          }
          await writeLocalIdentity({ sub, username });
        }
        // This install has an account now — never show the entry chooser again.
        writeEntryChoice("account");
        // Await provisioning before flipping to authenticated (GET /users/me
        // creates the row; other endpoints 404 until it exists). Best-effort:
        // if the API is unreachable we sign in anyway.
        await ensureUserExists().catch(console.error);
        setState("authenticated");
        return true;
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Sign in failed. Please try again."));
        return false;
      }
    },
    [],
  );

  const handleSignUp = useCallback(
    async (username: string, password: string, email: string, name: string) => {
      setError(null);
      try {
        // Email is the Cognito login identifier; display username goes to
        // preferred_username (same contract as web).
        const result = await amplifySignUp({
          username: email,
          password,
          options: { userAttributes: { email, name, preferred_username: username } },
        });
        if (result.nextStep.signUpStep === "CONFIRM_SIGN_UP") {
          setPendingUsername(email);
          setState("confirmSignUp");
        } else if (result.isSignUpComplete) {
          setState("signIn");
        }
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Sign up failed. Please try again."));
      }
    },
    [],
  );

  const handleConfirmSignUp = useCallback(
    async (code: string, password: string) => {
      setError(null);
      try {
        await amplifyConfirmSignUp({
          username: pendingUsername,
          confirmationCode: code,
        });
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Confirmation failed. Please try again."));
        return;
      }
      // Verified — sign straight in; fall back to the sign-in form only if
      // auto-login fails (handleSignIn has already set the error).
      const signedIn = await handleSignIn(pendingUsername, password);
      if (!signedIn) setState("signIn");
    },
    [pendingUsername, handleSignIn],
  );

  const handleResendCode = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await amplifyResendSignUpCode({ username: pendingUsername });
      return { ok: true };
    } catch (err) {
      console.error(err);
      return {
        ok: false,
        error: messageFromError(err, "Couldn't resend code. Please try again."),
      };
    }
  }, [pendingUsername]);

  const handleForgotPassword = useCallback(async (email: string) => {
    setError(null);
    try {
      const result = await amplifyResetPassword({ username: email });
      if (result.nextStep.resetPasswordStep === "CONFIRM_RESET_PASSWORD_WITH_CODE") {
        setPendingUsername(email);
        setState("confirmForgotPassword");
      }
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't send reset code. Please try again."));
    }
  }, []);

  const handleConfirmForgotPassword = useCallback(
    async (code: string, newPassword: string): Promise<boolean> => {
      setError(null);
      try {
        await amplifyConfirmResetPassword({
          username: pendingUsername,
          confirmationCode: code,
          newPassword,
        });
        setState("signIn");
        return true;
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Couldn't reset password. Please try again."));
        return false;
      }
    },
    [pendingUsername],
  );

  // Explicit sign-out is the one path that clears the local identity — the
  // privacy line, mirroring web's trip-draft clear. Cleared BEFORE the network
  // call so a signOut failure can't strand it. The data wipe itself is the
  // caller's (App.tsx), which owns the "N unsynced changes" confirmation.
  //
  // Lands on the chooser, not the sign-in form: a device with no account on it
  // is exactly the state the chooser exists for, and someone signing out may
  // well want to carry on without an account.
  const handleSignOut = useCallback(async () => {
    await clearLocalIdentity();
    // Not "account" — this device now has no account on it, and recording one
    // would send the next cold start to the sign-in form while this sign-out
    // sent them to the chooser. Same state, same screen, either way.
    clearEntryChoice();
    try {
      await amplifySignOut();
    } catch (err) {
      // Offline sign-out: Amplify clears local tokens regardless; the server-
      // side revocation just didn't happen. Log and continue.
      console.error(err);
    }
    setState("chooser");
  }, []);

  // ── Entry choice ──────────────────────────────────────────────────────────

  const chooseGuest = useCallback((): boolean => {
    if (!writeEntryChoice("guest")) {
      // A choice that didn't stick means the next cold start throws them back
      // here with their data apparently gone. Say so instead of proceeding.
      setError("This phone wouldn't remember that choice. Please try again.");
      return false;
    }
    setError(null);
    setState("guest");
    return true;
  }, []);

  /** Guest → the sign-in form, to link an account. Their local data is kept. */
  const linkAccount = useCallback(() => {
    setError(null);
    setState("signIn");
  }, []);

  /**
   * Back out of the auth forms. Where "back" goes depends on how they got
   * here, and the recorded entry choice already knows: a guest who tapped
   * "link an account" returns to their app with their data, everyone else
   * returns to the chooser. Reading the pref rather than tracking an origin
   * flag keeps the two paths from drifting.
   */
  const backToChooser = useCallback(() => {
    setError(null);
    setState(readEntryChoice() === "guest" ? "guest" : "chooser");
  }, []);

  const accountState: AccountState = state === "guest" ? "guest" : "linked";

  return {
    state,
    accountState,
    error,
    pendingUsername,
    signIn: handleSignIn,
    signUp: handleSignUp,
    confirmSignUp: handleConfirmSignUp,
    resendSignUpCode: handleResendCode,
    forgotPassword: handleForgotPassword,
    confirmForgotPassword: handleConfirmForgotPassword,
    signOut: handleSignOut,
    chooseGuest,
    linkAccount,
    backToChooser,
    goToSignUp: useCallback(() => { setError(null); setState("signUp"); }, []),
    goToSignIn: useCallback(() => { setError(null); setState("signIn"); }, []),
    goToForgotPassword: useCallback(() => { setError(null); setState("forgotPassword"); }, []),
  };
}
