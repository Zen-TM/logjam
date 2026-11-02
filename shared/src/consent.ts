/**
 * The consent version the API accepts and every GET /users/me names as
 * `currentConsentVersion`. A bump is this constant plus the "Last updated"
 * date in frontend/public/privacy.html and tos.html (guard:
 * api/src/constants/consent.unit.test.ts). Clients read the server's answer,
 * not this value, so a Logjam GPS build containing that read survives any bump;
 * they use this value only as the fallback against a server that predates
 * `currentConsentVersion` (and, in Logjam GPS, its sign-up form).
 *
 * Logjam GPS builds released before that read existed still strand on the
 * next bump: they gate on their baked constant and send it back, and the API
 * refuses it. Hold a bump until those builds are outside the ADR 0022 support
 * window.
 */
export const CURRENT_CONSENT_VERSION = "2026-11-02";

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
 * is older than the server's current one. A newer recorded version is not
 * stale: it is what an API rolled back past a bump serves, and re-asking
 * would only record the older version over text the pages no longer show.
 * Versions are YYYY-MM-DD, so the string compare is the date compare (guard:
 * the format test in consent.test.ts). Backs the blocking ConsentGate that
 * fulfils the privacy.html / tos.html promise of re-consent on next sign-in
 * after a material change. consentedAt needs no separate check — the server
 * sets consentVersion and consentedAt together (api/src/routes/users.ts).
 */
export function needsReconsent(user: ConsentUser): boolean {
  return (
    user.consentVersion === null ||
    user.consentVersion < currentConsentVersionOf(user)
  );
}
