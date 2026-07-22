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
//    in; same-user re-login keeps it. (Stage 1 has no local data yet — the
//    wipe hook is where Stage 4+ stores will register.)
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
import { classifySessionError } from "./sessionErrors";
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
  | "signIn"
  | "signUp"
  | "confirmSignUp"
  | "forgotPassword"
  | "confirmForgotPassword"
  | "authenticated";

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
    let cancelled = false;
    (async () => {
      const localIdentity = await readLocalIdentity().catch(() => null);
      try {
        const session = await fetchAuthSession();
        if (cancelled) return;
        if (session.tokens?.idToken) {
          setState("authenticated");
        } else {
          // No session in the store at all — genuinely signed out.
          setState("signIn");
        }
      } catch (err) {
        if (cancelled) return;
        if (classifySessionError(err) === "transient" && localIdentity) {
          // Offline/unreachable with a known local user: stay signed in
          // against local data; the API layer re-raises per-request.
          setState("authenticated");
        } else {
          setState("signIn");
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
        // user signing in wipes prior local data (none yet in Stage 1; the
        // check is the seam Stage 4+ hangs the wipe on).
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken?.toString();
        const sub = idToken ? decodeSubFromIdToken(idToken) : null;
        if (sub) {
          const previous = await readLocalIdentity().catch(() => null);
          if (previous && previous.sub !== sub) {
            // Stage 4+: wipe local stores here before the new identity lands.
            await clearLocalIdentity();
          }
          await writeLocalIdentity({ sub, username });
        }
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

  // Explicit sign-out is the one path that clears the local identity (and,
  // from Stage 4, local data) — the privacy line, mirroring web's trip-draft
  // clear. Cleared BEFORE the network call so a signOut failure can't strand it.
  const handleSignOut = useCallback(async () => {
    await clearLocalIdentity();
    try {
      await amplifySignOut();
    } catch (err) {
      // Offline sign-out: Amplify clears local tokens regardless; the server-
      // side revocation just didn't happen. Log and continue.
      console.error(err);
    }
    setState("signIn");
  }, []);

  return {
    state,
    error,
    pendingUsername,
    signIn: handleSignIn,
    signUp: handleSignUp,
    confirmSignUp: handleConfirmSignUp,
    resendSignUpCode: handleResendCode,
    forgotPassword: handleForgotPassword,
    confirmForgotPassword: handleConfirmForgotPassword,
    signOut: handleSignOut,
    goToSignUp: useCallback(() => { setError(null); setState("signUp"); }, []),
    goToSignIn: useCallback(() => { setError(null); setState("signIn"); }, []),
    goToForgotPassword: useCallback(() => { setError(null); setState("forgotPassword"); }, []),
  };
}
