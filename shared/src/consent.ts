/**
 * The consent version the API accepts and every GET /users/me names as
 * `currentConsentVersion`. A bump is this constant plus the "Last updated"
 * date in frontend/public/privacy.html and tos.html (guard: the consent test
 * in api/src/__tests__/users.test.ts). Clients read the server's answer, not
 * this value, so a build in the field keeps working across a bump; they use it
 * only where no server answer exists yet (the Logjam Web sign-up form) and as
 * the fallback against a server that predates `currentConsentVersion`.
 */
export const CURRENT_CONSENT_VERSION = "2026-09-28";

type ConsentUser = {
  consentVersion: string | null;
  /** Absent from a server that predates the field. */
  currentConsentVersion?: string;
};

/**
 * The version the server wants this user to have agreed to, and the one a
 * gate must send back: the API accepts only its own current version.
 */
export function currentConsentVersionOf(
  user: Pick<ConsentUser, "currentConsentVersion">,
): string {
  return user.currentConsentVersion ?? CURRENT_CONSENT_VERSION;
}

/**
 * True when the user must (re-)consent before proceeding: they have never
 * consented (legacy accounts, consentVersion null) or their recorded version
 * is not the server's current one. Backs the blocking ConsentGate that
 * fulfils the privacy.html / tos.html promise of re-consent on next sign-in
 * after a material change. consentedAt needs no separate check — the server
 * sets consentVersion and consentedAt together (api/src/routes/users.ts).
 */
export function needsReconsent(user: ConsentUser): boolean {
  return user.consentVersion !== currentConsentVersionOf(user);
}
