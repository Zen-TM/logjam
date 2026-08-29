import { useState, useEffect, useCallback } from "react";
import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  resendSignUpCode as amplifyResendSignUpCode,
  signOut as amplifySignOut,
  fetchAuthSession,
  resetPassword as amplifyResetPassword,
  confirmResetPassword as amplifyConfirmResetPassword,
} from "aws-amplify/auth";
import { apiFetch, setSessionExpiredHandler } from "./canyonUtils";
import { messageFromError } from "./errors/messageFromError";
import { mapAuthNextStep } from "./errors/authErrorMap";
import { clearTripDraft } from "./tripDraft";

// Calls GET /users/me after sign-in. The API creates a new user record
// if one doesn't exist yet (keyed on the Cognito sub), so this is safe
// to call on every sign-in, not just the first.
async function ensureUserExists() {
  await apiFetch("/users/me");
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
  // Username is stored between sign-up and confirmation steps
  const [pendingUsername, setPendingUsername] = useState("");

  // On mount, check if there's an existing valid session in localStorage.
  useEffect(() => {
    if (import.meta.env.VITE_AUTH_MODE === "fake") {
      setState("authenticated");
      return;
    }
    fetchAuthSession()
      .then((session) => {
        if (session.tokens?.idToken) {
          setState("authenticated");
        } else {
          setState("signIn");
        }
      })
      .catch(() => setState("signIn"));
  }, []);

  // Listen for mid-session token-refresh failures from apiFetch. When the
  // refresh token has expired or been revoked, drop back to the sign-in
  // screen with an explanatory banner instead of leaving the UI in a
  // half-authenticated state where every request 401s silently.
  useEffect(() => {
    if (import.meta.env.VITE_AUTH_MODE === "fake") return;
    setSessionExpiredHandler(() => {
      setState((prev) => {
        if (prev !== "authenticated") return prev;
        setError("Your session has expired. Please sign in again.");
        return "signIn";
      });
    });
    return () => setSessionExpiredHandler(null);
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
        // Await provisioning before flipping to authenticated: GET /users/me
        // creates the User row on first login, and every other endpoint 404s
        // ("User not found") until that row exists. Flipping state first let
        // the boot-time data hooks race the insert and surface a burst of
        // error toasts on fresh accounts. Still best-effort — if the API is
        // unreachable we sign in anyway rather than blocking the user.
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
        // Use email as the Cognito login identifier, store display
        // username in preferred_username so it's included in the JWT.
        const result = await amplifySignUp({
          username: email,
          password,
          options: { userAttributes: { email, name, preferred_username: username } },
        });
        if (result.nextStep.signUpStep === "CONFIRM_SIGN_UP") {
          setPendingUsername(email);
          setState("confirmSignUp");
        } else if (result.isSignUpComplete) {
          // Auto-confirmed (unlikely with email verification on)
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
      // Account verified — sign the user straight in (email is the Cognito
      // username, matching signUp). Go confirmSignUp → authenticated with no
      // sign-in screen in between. Only if auto-login fails do we fall back to
      // the pre-filled sign-in form (handleSignIn has already set the error).
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
      return { ok: false, error: messageFromError(err, "Couldn't resend code. Please try again.") };
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

  const handleSignOut = useCallback(async () => {
    // A trip draft is canyon names and notes in localStorage, readable by
    // anything on the origin and unaffected by the reload below. It must not
    // outlive the session that wrote it — sign-out is the line (privacy rules,
    // root CLAUDE.md). Cleared before the network call so a signOut failure
    // can't strand it.
    clearTripDraft();
    // amplifySignOut can reject (storage error, network hiccup during global
    // revoke, an Amplify internal error) — without the try/catch, the
    // rejection propagates into an onClick handler that ignores promises, so
    // the reload never happens and the UI is stuck looking signed-in with the
    // draft already gone (FECO-008). Reload unconditionally either way,
    // matching RootErrorBoundary.handleSignOut's identical flow.
    try {
      await amplifySignOut();
    } catch (err) {
      console.error(err);
    }
    window.location.reload();
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
