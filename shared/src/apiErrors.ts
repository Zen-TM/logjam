// Shared API/auth error types + user-facing message mapping, used by both web
// (frontend) and mobile. Moved from frontend/src/errors/ so the two clients
// can never diverge on error semantics (same motivation as consent.ts).
//
// ApiError identity matters: messageFromError branches on `instanceof ApiError`,
// so every client must construct and check the SAME class — always import it
// from @logjam/shared, never redeclare locally.

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

// ── Cognito/Amplify auth error mapping ────────────────────────────────────────

const AUTH_ERROR_CODES: Record<string, string> = {
  NotAuthorizedException: "Incorrect username or password.",
  UserNotConfirmedException: "Please confirm your email address before signing in.",
  UserNotFoundException: "No account found with that email address.",
  UsernameExistsException: "An account with that email already exists.",
  InvalidPasswordException: "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol.",
  CodeMismatchException: "Incorrect verification code. Please check your email (check spam) and try again.",
  ExpiredCodeException: "That verification code has expired. Please request a new one.",
  LimitExceededException: "Too many attempts. Please wait a few minutes and try again.",
  InvalidParameterException: "Please check your details and try again.",
  NetworkError: "Couldn't connect. Please check your internet connection.",
};

const AUTH_NEXT_STEPS: Record<string, string> = {
  CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED: "You must set a new password to continue.",
  CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE: "Additional verification is required.",
  CONFIRM_SIGN_IN_WITH_TOTP_CODE: "Please enter your authenticator code.",
  CONFIRM_SIGN_IN_WITH_SMS_CODE: "Please enter the code sent to your phone.",
  RESET_PASSWORD: "Your password must be reset before you can sign in.",
  CONFIRM_SIGN_UP: "Please confirm your email address before signing in.",
  DONE: "Sign-in complete.",
};

export function mapAuthError(err: unknown): string | null {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code ?? err.name;
    if (code && AUTH_ERROR_CODES[code]) return AUTH_ERROR_CODES[code];
  }
  return null;
}

export function mapAuthNextStep(step: string): string {
  return AUTH_NEXT_STEPS[step] ?? "Additional verification is required.";
}

// ── User-facing message derivation ────────────────────────────────────────────

const STATUS_MESSAGES: Record<number, string | undefined> = {
  401: "You're not authorised to do that. Please sign in and try again.",
  403: "You don't have permission to do that.",
  404: "The requested item could not be found.",
  409: undefined, // let serverMessage win for 409 (domain-specific conflicts)
  429: "Too many requests. Please wait a moment and try again.",
  500: "Something went wrong on the server. Please try again.",
  503: "The server is temporarily unavailable. Please try again shortly.",
};

export function messageFromError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.serverMessage) return err.serverMessage;
    const statusMsg = STATUS_MESSAGES[err.status];
    if (statusMsg) return statusMsg;
    if (err.status >= 500) return "Something went wrong on the server. Please try again.";
    if (err.status >= 400) return fallback;
  }

  const authMsg = mapAuthError(err);
  if (authMsg) return authMsg;

  if (err instanceof Error && err.message === "Network Error") {
    return "Couldn't reach the server. Please check your connection and try again.";
  }
  // Browser fetch throws TypeError("Failed to fetch"); React Native's fetch
  // throws TypeError("Network request failed"). Match both.
  if (
    err instanceof TypeError &&
    /fetch|network request failed/i.test(err.message)
  ) {
    return "Couldn't reach the server. Please check your connection and try again.";
  }

  return fallback;
}
