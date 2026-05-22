const AUTH_ERROR_CODES: Record<string, string> = {
  NotAuthorizedException: "Incorrect username or password.",
  UserNotConfirmedException: "Please confirm your email address before signing in.",
  UserNotFoundException: "No account found with that email address.",
  UsernameExistsException: "An account with that email already exists.",
  InvalidPasswordException: "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol.",
  CodeMismatchException: "Incorrect verification code. Please check your email and try again.",
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
