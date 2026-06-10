// Must stay in sync with api/src/constants/consent.ts
export const CURRENT_CONSENT_VERSION = "2026-06-03";

export const PENDING_CONSENT_STORAGE_KEY = "logjam.pendingConsentVersion";

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
