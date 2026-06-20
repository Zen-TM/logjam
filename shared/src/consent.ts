/**
 * Canonical consent version — single source for api + frontend (the two
 * previously diverged: api was bumped to 2026-06-11 while frontend stayed on
 * 2026-06-03, so ConsentGate's PATCH was rejected with "Invalid
 * consentVersion" in prod). Bump only when ToS / privacy.html materially
 * change; the api rejects any other version and the frontend blocks behind
 * ConsentGate until the recorded version matches.
 */
export const CURRENT_CONSENT_VERSION = "2026-06-21";

/**
 * True when the user must (re-)consent before using the app: they have never
 * consented (legacy accounts, consentVersion null) or their recorded version
 * is stale. Backs the blocking ConsentGate that fulfils the privacy.html /
 * tos.html promise of re-consent on next sign-in after a material change.
 * consentedAt needs no separate check — the server sets consentVersion and
 * consentedAt together (api/src/routes/users.ts).
 */
export function needsReconsent(
  user: { consentVersion: string | null },
  currentVersion: string = CURRENT_CONSENT_VERSION,
): boolean {
  return user.consentVersion !== currentVersion;
}
