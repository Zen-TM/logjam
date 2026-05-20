import { useState, useEffect, useCallback } from "react";
import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  signOut as amplifySignOut,
  fetchAuthSession,
  resetPassword as amplifyResetPassword,
  confirmResetPassword as amplifyConfirmResetPassword,
} from "aws-amplify/auth";
import { apiFetch } from "./canyonUtils";
import { messageFromError } from "./errors/messageFromError";
import { mapAuthNextStep } from "./errors/authErrorMap";

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

  const handleSignIn = useCallback(
    async (username: string, password: string) => {
      setError(null);
      try {
        const result = await amplifySignIn({ username, password });
        if (!result.isSignedIn) {
          setError(mapAuthNextStep(result.nextStep.signInStep));
          return;
        }
        // Best-effort: don't block sign-in if the API is unreachable
        ensureUserExists().catch(console.error);
        setState("authenticated");
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Sign in failed. Please try again."));
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
    async (code: string) => {
      setError(null);
      try {
        await amplifyConfirmSignUp({
          username: pendingUsername,
          confirmationCode: code,
        });
        setState("signIn");
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Confirmation failed. Please try again."));
      }
    },
    [pendingUsername],
  );

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
    await amplifySignOut();
    window.location.reload();
  }, []);

  return {
    state,
    error,
    pendingUsername,
    signIn: handleSignIn,
    signUp: handleSignUp,
    confirmSignUp: handleConfirmSignUp,
    forgotPassword: handleForgotPassword,
    confirmForgotPassword: handleConfirmForgotPassword,
    signOut: handleSignOut,
    goToSignUp: useCallback(() => { setError(null); setState("signUp"); }, []),
    goToSignIn: useCallback(() => { setError(null); setState("signIn"); }, []),
    goToForgotPassword: useCallback(() => { setError(null); setState("forgotPassword"); }, []),
  };
}
