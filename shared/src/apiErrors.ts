// Shared API/auth error types + user-facing message mapping, used by both
// Logjam Web and Logjam GPS so the two clients never diverge on error
// semantics.
//
// ApiError identity matters: messageFromError branches on `instanceof ApiError`,
// so every client must construct and check the SAME class — always import it
// from @logjam/shared, never redeclare locally.

import { SERVER_FAULT_SENTENCE } from "./userSentence.js";

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly method: string;
  readonly serverMessage?: string;

  constructor(
    status: number,
    path: string,
    method: string,
    serverMessage?: string,
  ) {
    super(`API error ${status}: ${method} ${path}`);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
    this.method = method;
    this.serverMessage = serverMessage;
  }
}

// ── Cognito account-call error mapping ────────────────────────────────────────

export const AUTH_ERROR_CODES: Record<string, string> = {
  NotAuthorizedException: "Incorrect email or password.",
  UserNotConfirmedException: "Confirm your email address before signing in.",
  UserNotFoundException: "No account found with that email address.",
  UsernameExistsException: "An account with that email already exists.",
  InvalidPasswordException:
    "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol.",
  CodeMismatchException:
    "Incorrect verification code. Check your email (and spam) and try again.",
  ExpiredCodeException:
    "That verification code has expired. Request a new one.",
  LimitExceededException:
    "Too many attempts. Wait a few minutes and try again.",
  InvalidParameterException: "Check your details and try again.",
  NetworkError: "Couldn't connect. Check your internet connection.",
};

// Cognito wraps a pre sign-up Lambda's error as "PreSignUp failed with error
// <text>" under UserLambdaValidationException, a name other triggers share, so
// the cap is recognised by the sentence the Lambda throws, which must match
// CAP_MESSAGE in infra/lambda/cognito-pre-signup/src/index.ts. Guard:
// apiErrors.test.ts.
export const SIGNUP_CAP_SENTENCE =
  "Logjam is not taking new accounts this month";
export const SIGNUP_CAP_MESSAGE =
  "Logjam isn't taking new accounts right now. Try again next month.";

export function mapAuthError(err: unknown): string | null {
  if (err instanceof Error) {
    if (
      err.name === "UserLambdaValidationException" &&
      err.message.includes(SIGNUP_CAP_SENTENCE)
    ) {
      return SIGNUP_CAP_MESSAGE;
    }
    const code = (err as { code?: string }).code ?? err.name;
    if (code && AUTH_ERROR_CODES[code]) return AUTH_ERROR_CODES[code];
  }
  return null;
}

// ── User-facing message derivation ────────────────────────────────────────────

const SERVER_ERROR_MESSAGE: string = SERVER_FAULT_SENTENCE;
const NETWORK_ERROR_MESSAGE =
  "Couldn't reach Logjam. Check your connection and try again.";

// 403 and 404 are absent on purpose: only the caller knows what it was after
// ("Couldn't find this place."), so its fallback beats a generic sentence.
const STATUS_MESSAGES: Record<number, string | undefined> = {
  401: "You're signed out. Sign in and try again.",
  429: "Too many requests. Wait a moment and try again.",
  500: SERVER_ERROR_MESSAGE,
  503: "Logjam is unavailable for a moment. Try again shortly.",
};

/**
 * The one path from a failure to the words a client shows. The API writes its
 * sentence for the user (`say` in userSentence.ts), so it is shown as it is:
 * a client never rewrites it, parses it, or picks its own words by status.
 * `STATUS_MESSAGES` and `fallback` are for a response that carried no sentence
 * (a proxy's 502, a network failure).
 */
export function messageFromError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.serverMessage) return err.serverMessage;
    const statusMsg = STATUS_MESSAGES[err.status];
    if (statusMsg) return statusMsg;
    if (err.status >= 500) return SERVER_ERROR_MESSAGE;
    if (err.status >= 400) return fallback;
  }

  const authMsg = mapAuthError(err);
  if (authMsg) return authMsg;

  if (err instanceof Error && err.message === "Network Error") {
    return NETWORK_ERROR_MESSAGE;
  }
  // Browser fetch throws TypeError("Failed to fetch"); React Native's fetch
  // throws TypeError("Network request failed"). Match both.
  if (
    err instanceof TypeError &&
    /fetch|network request failed/i.test(err.message)
  ) {
    return NETWORK_ERROR_MESSAGE;
  }

  return fallback;
}
