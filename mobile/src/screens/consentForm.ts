// What the consent gate checks before it sends anything. Pulled out of the
// screen so the rules can run in a test (mobile/ has no renderer), and to match
// Logjam Web's ConsentGate, which asks a new account the same questions.
import { isValidUsername, USERNAME_RULE } from "@logjam/shared";

export type ConsentFormProblem =
  | { field: "username"; message: string }
  | { field: "form"; message: string };

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
    return { field: "username", message: USERNAME_RULE };
  }
  if (!form.agreed) {
    return {
      field: "form",
      message: form.newAccount
        ? "Agree to the Terms of Use and Privacy Policy to continue."
        : "Tick the box to agree to the updated terms.",
    };
  }
  if (form.newAccount && !form.ageConfirmed) {
    return {
      field: "form",
      message: "Confirm you are 18 or older to continue.",
    };
  }
  return null;
}
