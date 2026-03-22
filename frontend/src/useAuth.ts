import { useState, useEffect, useCallback } from "react";
import {
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  fetchAuthSession,
} from "aws-amplify/auth";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

// Calls GET /users/me after sign-in. The API creates a new user record
// if one doesn't exist yet (keyed on the Cognito sub), so this is safe
// to call on every sign-in, not just the first.
async function ensureUserExists() {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) return;

  await fetch(`${API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function useAuth() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // On mount, check if there's an existing valid session in localStorage.
  // This lets users stay logged in across page refreshes without re-entering
  // credentials — Amplify stores tokens in localStorage automatically.
  useEffect(() => {
    fetchAuthSession()
      .then((session) => {
        if (session.tokens?.idToken) {
          setAuthenticated(true);
        }
      })
      .catch(() => {
        // No session — user needs to sign in
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSignIn = useCallback(
    async (username: string, password: string) => {
      setError(null);
      try {
        await amplifySignIn({ username, password });
        await ensureUserExists();
        setAuthenticated(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign in failed");
      }
    },
    [],
  );

  const handleSignOut = useCallback(async () => {
    await amplifySignOut();
    setAuthenticated(false);
  }, []);

  return {
    authenticated,
    loading,
    error,
    signIn: handleSignIn,
    signOut: handleSignOut,
  };
}
