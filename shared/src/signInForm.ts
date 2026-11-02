// What Logjam Web's and Logjam GPS's own sign-in and sign-up forms decide
// before and after they reach Cognito (ADR 0045), so the two cannot drift
// (ADR 0020). Each client draws the forms itself.
import { USERNAME_RULE, isValidUsername } from "./username.js";

export const PASSWORD_HINT =
  "At least 8 characters, with an upper and a lower case letter, a number and a symbol.";

const PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{8,}$/;

export const isValidPassword = (password: string): boolean =>
  PASSWORD_PATTERN.test(password);

// Pragmatic and deliberately not RFC 5322: it catches a missing @ or domain, a
// space or a trailing dot before a round trip. Cognito decides acceptance.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmailFormat = (email: string): boolean =>
  EMAIL_PATTERN.test(email.trim());

export type SignUpFormProblem = {
  field: "email" | "username" | "form";
  message: string;
};

/** The first thing wrong with the sign-up form, or null when it can be sent. */
export function signUpFormProblem(form: {
  name: string;
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
  agreed: boolean;
  ageConfirmed: boolean;
}): SignUpFormProblem | null {
  // The pool requires it (infra/terraform/envs/prod/cognito.tf).
  if (!form.name.trim()) {
    return { field: "form", message: "Enter your name." };
  }
  if (!isValidEmailFormat(form.email)) {
    return { field: "email", message: "Enter a valid email address." };
  }
  if (!isValidUsername(form.username)) {
    return { field: "username", message: USERNAME_RULE };
  }
  if (form.password !== form.confirmPassword) {
    return { field: "form", message: "Passwords do not match" };
  }
  if (!isValidPassword(form.password)) {
    return {
      field: "form",
      message:
        "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol",
    };
  }
  if (!form.agreed) {
    return {
      field: "form",
      message: "Agree to the Terms of Use and Privacy Policy to sign up.",
    };
  }
  if (!form.ageConfirmed) {
    return {
      field: "form",
      message: "Confirm you are 18 or older to sign up.",
    };
  }
  return null;
}

// Cognito's answers about this person or this attempt, which the form shows.
// Anything else means the form cannot finish here (a flow the app client no
// longer allows, a forced password reset, a blocked request), so the provider's
// own page takes over.
const FORM_ANSWERS = new Set([
  "NotAuthorizedException",
  "UserNotConfirmedException",
  "UserNotFoundException",
  "LimitExceededException",
  "TooManyRequestsException",
]);

/**
 * Whether a failed password sign-in stays on the form. Cognito's own answer
 * does; so does any failure while offline, because the provider's page could
 * not load either. Anything else hands over to the provider's page.
 */
export function failureStaysOnForm(err: unknown, online: boolean): boolean {
  return !online || (err instanceof Error && FORM_ANSWERS.has(err.name));
}

/**
 * Before sign-up, so no token. Unknown counts as free: the welcome form
 * catches a clash. `headers` carries a client's version header.
 */
export async function usernameAvailable(
  apiBaseUrl: string,
  username: string,
  headers: Record<string, string> = {},
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(
      `${apiBaseUrl}/users/username-available?username=${encodeURIComponent(username)}`,
      { headers, signal: controller.signal },
    );
    return !res.ok || (await res.json()).available !== false;
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}
