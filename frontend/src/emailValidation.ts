// Pragmatic client-side email-format check used before handing an address to
// Cognito (ChangeEmailDialog). Deliberately NOT RFC-5322 complete — it catches
// the obvious mistakes (missing @, missing domain, spaces, trailing dot) so the
// user gets instant inline feedback instead of a round-trip error. Cognito
// remains the source of truth for acceptance.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailFormat(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}
