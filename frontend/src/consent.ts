// Thin re-export — the canonical consent version and needsReconsent() live in
// shared/src/consent.ts so api and frontend do not diverge.
import {
  CURRENT_CONSENT_VERSION,
  currentConsentVersionOf,
  needsReconsent,
} from "@logjam/shared";

export { CURRENT_CONSENT_VERSION, currentConsentVersionOf, needsReconsent };

export const PENDING_CONSENT_STORAGE_KEY = "logjam.pendingConsentVersion";

/**
 * The single consent decision, used twice: to render ConsentGate INSTEAD of
 * Logjam Web, and to hold every user-data hook and boot effect until consent
 * is settled (frontend/AGENTS.md, src/consent.test.ts).
 *
 * Two callers, one derivation, on purpose: a gate that renders on a different
 * condition than the one holding the fetches would allow user data to load
 * behind the gate.
 *
 * `blocked` and `settled` are not opposites — while `currentUser` is still
 * loading neither is true, which is what makes the prefetches wait rather than
 * race the answer.
 */
export function consentGate(
  currentUser: Parameters<typeof needsReconsent>[0] | null,
  pendingConsentVersion: string | null,
): { blocked: boolean; settled: boolean } {
  // Nothing to decide from yet. Not blocked (no gate flash before we know),
  // not settled (no fetches until we do).
  if (!currentUser) return { blocked: false, settled: false };
  // A pending version matching the server's current one is a consent just given on the
  // sign-up form and not yet recorded server-side. Gating on it would trap a
  // brand-new user behind a gate for a box they already ticked.
  const blocked =
    needsReconsent(currentUser) &&
    pendingConsentVersion !== currentConsentVersionOf(currentUser);
  return { blocked, settled: !blocked };
}
