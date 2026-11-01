// OIDC auth hook: one button opens the provider's sign-in and sign-up page in
// the system browser sheet (oidcSession.ts); Logjam GPS never handles a
// password. The mobile offline-session semantics:
//
//  - Auth gates the API, not local data. After first successful login the
//    local identity (sub/username) persists; the app cold-starts into that
//    account with zero network.
//  - NEVER auto-sign-out on token expiry or unreachability. Re-auth is forced
//    only when the provider actively rejects the refresh while online
//    (setSessionRejectedHandler ← classifySessionError, Guard: sessionErrors.test.ts),
//    or there is no session at all.
//  - Tokens refresh on app-foreground-while-online so a trip starts with a
//    fresh runway. Nothing refreshes on a timer.
//  - Local data is wiped on explicit sign-out or when a DIFFERENT user signs
//    in; same-user re-login keeps it (finishSignIn.ts).
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
import { messageFromError } from "@logjam/shared";

import { config } from "../config";
import { setSessionRejectedHandler } from "../api/apiFetch";
import {
  endProviderSession,
  getSession,
  signInWithBrowser,
  signOutLocally,
} from "./oidcSession";
import { finishSignIn } from "./finishSignIn";
import { classifySessionError } from "./sessionErrors";
import type { AccountState } from "./capabilities";
import {
  clearEntryChoice,
  readEntryChoice,
  writeEntryChoice,
} from "./guestModePreference";
import { clearLocalIdentity, readLocalIdentity } from "./localIdentity";

// Fake auth has no provider to open. The sign-in button enters as the build's
// fake user (alice, or EXPO_PUBLIC_FAKE_SUB), the same "authenticated" with no
// stored identity that a fake-auth launch starts in; `apiFetch` supplies the
// identity. The entry choice is what keeps a guest who
// linked from restarting as a guest.
function enterAsFakeUser(): void {
  writeEntryChoice("account");
}

export type AuthState =
  | "loading"
  /** Fresh install, nothing chosen: sign in, or continue without an account. */
  | "chooser"
  /** No account by choice. The app runs; server-backed features are gated. */
  | "guest"
  | "signIn"
  | "authenticated";

/** The two states that mount the real app shell. */
export function mountsAppShell(state: AuthState): boolean {
  return state === "authenticated" || state === "guest";
}

export function useAuth() {
  // The fake-auth and guest outcomes are synchronous reads, so they are the
  // first render's state rather than a "loading" frame an effect replaces.
  const [state, setState] = useState<AuthState>(() => {
    // Fake auth has no session to restore, but a recorded guest choice is
    // still this device's answer. Ignoring it would make guest mode
    // unreachable in local dev — the one environment it can be exercised in —
    // and would throw a guest into an account on their next cold start. Nothing
    // recorded still means "straight in", so the dev entry flow is unchanged
    // for everyone who never asked for guest mode.
    if (config.authMode === "fake") {
      return readEntryChoice() === "guest" ? "guest" : "authenticated";
    }
    // A recorded guest choice short-circuits every network and Keychain call
    // in the restore effect: a guest has no session to restore, and asking
    // the provider about one would put a timeout between them and their own local
    // data.
    return readEntryChoice() === "guest" ? "guest" : "loading";
  });
  const [error, setError] = useState<string | null>(null);

  // On mount: restore the session. Offline with a persisted identity still
  // lands in "authenticated" — an expired token is irrelevant until a request
  // needs it (offline-first rule).
  useEffect(() => {
    if (config.authMode === "fake") return;
    const entryChoice = readEntryChoice();
    if (entryChoice === "guest") return;
    // Fresh install with nothing chosen — offer the choice before the sign-in
    // form, which is otherwise a wall in front of an app that mostly doesn't
    // need an account.
    const signedOutState: AuthState =
      entryChoice === "account" ? "signIn" : "chooser";

    let cancelled = false;
    (async () => {
      const localIdentity = await readLocalIdentity().catch(() => null);
      try {
        // Timed out (oidcSession.ts): until this settles `App` shows its
        // loading screen, and a hang here IS the "stuck on the logo screen" a
        // cold start produced in the field. A timeout classifies transient, so
        // the branch below keeps a known user signed in against local data.
        const session = await getSession();
        if (cancelled) return;
        if (session) {
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
        getSession().catch((err: unknown) => {
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

  const handleSignIn = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (config.authMode === "fake") {
      enterAsFakeUser();
      setState("authenticated");
      return true;
    }
    try {
      const result = await signInWithBrowser();
      // A closed sheet is the user's answer, not an error.
      if (result.type === "cancel") return false;
      const finished = await finishSignIn(result);
      if (!finished.ok) {
        setError(finished.error);
        return false;
      }
      setState("authenticated");
      return true;
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Sign in failed."));
      return false;
    }
  }, []);

  // Explicit sign-out is the one path that clears the local identity — the
  // privacy line, mirroring web's trip-draft clear. Tokens and identity go
  // BEFORE any network call, so a failure there can't strand them, and with no
  // network the sign-out is already complete. The provider's session is ended
  // afterwards, best effort (endProviderSession). The data wipe itself and
  // "Sign out everywhere" are the caller's (App.tsx, signOutSequence.ts), which
  // owns the "N unsynced changes" confirmation.
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
    let ended = null;
    try {
      ended = await signOutLocally();
    } catch (err) {
      console.error(err);
    }
    setState("chooser");
    // Under the chooser, so the browser sheet that ends the provider's session
    // opens over a signed-out Logjam GPS.
    await endProviderSession(ended).catch(console.error);
  }, []);

  // ── Entry choice ──────────────────────────────────────────────────────────

  const chooseGuest = useCallback((): boolean => {
    if (!writeEntryChoice("guest")) {
      // A choice that didn't stick means the next cold start throws them back
      // here with their data apparently gone. Say so instead of proceeding.
      setError("Couldn't save that choice. Try again.");
      return false;
    }
    setError(null);
    setState("guest");
    return true;
  }, []);

  /** Guest → the sign-in screen, to link an account. Their local data is kept. */
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

  /**
   * May this screen still offer "continue without an account"?
   *
   * Keyed on the recorded entry choice, NOT on the auth state, because the
   * landing screen renders for both `chooser` and `signIn` and the two are the
   * same screen: keying on the state would offer "Back" to anyone who reached
   * sign-in from the sign-up form, and Back goes to `chooser`, which IS that
   * screen — a button whose only visible effect would be to relabel itself.
   *
   * A guest linking an account is the one case where Back means something: it
   * returns them to their app, with their data. Everyone else has somewhere to
   * go without an account, so they are offered that instead.
   */
  const offersGuestEntry = readEntryChoice() !== "guest";

  return {
    state,
    accountState,
    offersGuestEntry,
    error,
    signIn: handleSignIn,
    signOut: handleSignOut,
    chooseGuest,
    linkAccount,
    backToChooser,
  };
}
