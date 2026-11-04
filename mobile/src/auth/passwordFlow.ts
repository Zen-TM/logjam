// Logjam GPS's own sign-in under a Cognito issuer (ADR 0045): what a password
// attempt does next. Pulled out of `useAuth` so every branch can be tested
// without a renderer, as `finishSignIn` is.
//
// The password is a parameter, used once and not kept: nothing here stores it,
// logs it, or puts it in a message (Guard: passwordPrivacy.test.ts).
import {
  currentConsentVersionOf,
  failureStaysOnForm,
  messageFromError,
  parseCognitoIssuer,
} from "@logjam/shared";

import { fetchCurrentUser, updateConsent } from "../api/queries";
import { isReachableNow } from "../map/connectivity";
import { finishSignIn } from "./finishSignIn";
import { signInWithPassword } from "./oidcSession";

export const OFFLINE_SIGN_IN = "No connection. Connect to sign in.";
export const WEAK_LINK_SIGN_IN = "Couldn't reach sign-in. Try again.";

// A slow or dropped link, or Cognito itself down: nothing about this attempt or
// this app client, and the browser sheet would fail on the same link.
const LINK_FAILURES = new Set([
  "SessionTimeoutError",
  "TypeError",
  "InternalErrorException",
  "ServiceUnavailableException",
]);
const isLinkFailure = (err: unknown) =>
  err instanceof Error && LINK_FAILURES.has(err.name);

/** The forms exist only under a Cognito issuer and real auth; any other issuer keeps the one button. */
export function usesOwnForms(
  authMode: string,
  issuer: string | undefined,
): boolean {
  return authMode !== "fake" && !!issuer && parseCognitoIssuer(issuer) !== null;
}

export type FormAnswer = Extract<PasswordSignInResult, { type: "form" }>;

export type PasswordSignInResult =
  /** Signed in and the phone is ready: open Logjam GPS. */
  | { type: "signedIn" }
  /** Only the provider's page can finish this: open the browser sheet. */
  | { type: "provider" }
  /** Stays on the form with `message`; `unconfirmed` asks for the emailed code. */
  | { type: "form"; message: string; unconfirmed: boolean };

/**
 * `newAccountUsername` is set only when the sign-up form, ticks and all, was
 * accepted: it is what records consent at first sign-in, as on Logjam Web. If
 * recording fails, ConsentGate asks.
 */
export async function signInWithPasswordFlow(
  email: string,
  password: string,
  newAccountUsername?: string,
): Promise<PasswordSignInResult> {
  let attempt;
  try {
    attempt = await signInWithPassword(email, password);
  } catch (err) {
    const online = await isReachableNow().catch(() => true);
    if (online && isLinkFailure(err)) {
      return { type: "form", message: WEAK_LINK_SIGN_IN, unconfirmed: false };
    }
    if (failureStaysOnForm(err, online)) {
      return {
        type: "form",
        message: online
          ? messageFromError(err, "Couldn't sign you in. Try again.")
          : OFFLINE_SIGN_IN,
        unconfirmed:
          err instanceof Error && err.name === "UserNotConfirmedException",
      };
    }
    // The name only: an error's message is not ours to log.
    console.error(
      "Password sign-in handed over to the provider",
      err instanceof Error ? err.name : typeof err,
    );
    return { type: "provider" };
  }
  if (attempt.type === "provider") return { type: "provider" };
  const finished = await finishSignIn(attempt);
  if (!finished.ok) {
    return { type: "form", message: finished.error, unconfirmed: false };
  }
  if (newAccountUsername) {
    // The server's version, not this build's: it refuses any other, and the
    // username goes with it. A build can be months old (ADR 0022).
    await fetchCurrentUser()
      .then((me) =>
        updateConsent(currentConsentVersionOf(me), newAccountUsername),
      )
      .catch(() => console.error("Couldn't record consent at sign-up"));
  }
  return { type: "signedIn" };
}
