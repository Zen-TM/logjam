import { useState, useEffect, useCallback } from "react";
import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  signOut as amplifySignOut,
  fetchAuthSession,
} from "aws-amplify/auth";
import { apiFetch } from "./canyonUtils";

// Calls GET /users/me after sign-in. The API creates a new user record
// if one doesn't exist yet (keyed on the Cognito sub), so this is safe
// to call on every sign-in, not just the first.
async function ensureUserExists() {
  await apiFetch("/users/me");
}

export type AuthState = "loading" | "signIn" | "signUp" | "confirmSignUp" | "authenticated";

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
          setError(`Sign-in incomplete: ${result.nextStep.signInStep}`);
          return;
        }
        // Best-effort: don't block sign-in if the API is unreachable
        ensureUserExists().catch(console.error);
        setState("authenticated");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign in failed");
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
        setError(err instanceof Error ? err.message : "Sign up failed");
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
        setError(err instanceof Error ? err.message : "Confirmation failed");
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
    signOut: handleSignOut,
    goToSignUp: useCallback(() => { setError(null); setState("signUp"); }, []),
    goToSignIn: useCallback(() => { setError(null); setState("signIn"); }, []),
  };
}
