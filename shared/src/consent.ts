/**
 * Canonical consent version — single source for api + frontend so the two
 * cannot diverge. Bump only when ToS / privacy.html materially change; the
 * api rejects any other version and the frontend blocks behind ConsentGate
 * until the recorded version matches.
 */
export const CURRENT_CONSENT_VERSION = "2026-10-19";

/**
 * True when the user must (re-)consent before proceeding: they have never
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
