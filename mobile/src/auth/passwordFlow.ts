// Logjam GPS's own sign-in under a Cognito issuer (ADR 0045): what a password
// attempt does next. Pulled out of `useAuth` so every branch can be tested
// without a renderer, as `finishSignIn` is.
//
// The password is a parameter, used once and not kept: nothing here stores it,
// logs it, or puts it in a message (Guard: passwordPrivacy.test.ts).
import {
  CURRENT_CONSENT_VERSION,
  failureStaysOnForm,
  messageFromError,
  parseCognitoIssuer,
} from "@logjam/shared";

import { updateConsent } from "../api/queries";
import { isReachableNow } from "../map/connectivity";
import { finishSignIn } from "./finishSignIn";
import { signInWithPassword } from "./oidcSession";

export const OFFLINE_SIGN_IN = "No connection. Connect to sign in.";

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
    if (failureStaysOnForm(err, online)) {
      return {
        type: "form",
        message: online
          ? messageFromError(err, "Sign in failed. Please try again.")
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
    await updateConsent(CURRENT_CONSENT_VERSION, newAccountUsername).catch(() =>
      console.error("Couldn't record consent at sign-up"),
    );
  }
  return { type: "signedIn" };
}
