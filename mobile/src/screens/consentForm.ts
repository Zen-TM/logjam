// What the consent gate checks before it sends anything. Pulled out of the
// screen so the rules can run in a test (mobile/ has no renderer), and to match
// Logjam Web's ConsentGate, which asks a new account the same questions.
import {
  ApiError,
  isValidUsername,
  messageFromError,
  USERNAME_RULE,
} from "@logjam/shared";

/** `retry`: whether sending again can help. A form problem never can. */
export type ConsentFormProblem =
  | { field: "username"; message: string; retry: boolean }
  | { field: "form"; message: string; retry: boolean };

/**
 * The first thing wrong with the form, or null when it can be sent. A new
 * account (no consent recorded yet) also picks a username and confirms its age,
 * because the provider's sign-up page cannot ask either; a returning user only
 * agrees to the updated terms.
 */
export function consentFormProblem(form: {
  newAccount: boolean;
  username: string;
  agreed: boolean;
  ageConfirmed: boolean;
}): ConsentFormProblem | null {
  if (form.newAccount && !isValidUsername(form.username)) {
    return { field: "username", message: USERNAME_RULE, retry: false };
  }
  if (!form.agreed) {
    return {
      field: "form",
      message: form.newAccount
        ? "Agree to the Terms of Use and Privacy Policy to continue."
        : "Tick the box to agree to the updated terms.",
      retry: false,
    };
  }
  if (form.newAccount && !form.ageConfirmed) {
    return {
      field: "form",
      message: "Confirm you are 18 or older to continue.",
      retry: false,
    };
  }
  return null;
}

/**
 * Where a failed consent PATCH shows. A new account's 400 or 409 is the API
 * refusing the username: it belongs under the field and is not worth a retry
 * (shared/DESIGN.md section 11-12). Anything else is a request failure, the
 * only kind "Try again" can help.
 */
export function consentSubmitFailure(
  err: unknown,
  newAccount: boolean,
): ConsentFormProblem {
  const message = messageFromError(
    err,
    "Couldn't record your consent. Please try again.",
  );
  if (
    newAccount &&
    err instanceof ApiError &&
    [400, 409].includes(err.status)
  ) {
    return { field: "username", message, retry: false };
  }
  return { field: "form", message, retry: true };
}
