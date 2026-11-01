// Thin re-export — the canonical consent version and needsReconsent() live in
// shared/src/consent.ts so api and frontend do not diverge.
import {
  CURRENT_CONSENT_VERSION,
  currentConsentVersionOf,
  needsReconsent,
} from "@logjam/shared";

export { CURRENT_CONSENT_VERSION, currentConsentVersionOf, needsReconsent };

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
): { blocked: boolean; settled: boolean } {
  // Nothing to decide from yet. Not blocked (no gate flash before we know),
  // not settled (no fetches until we do).
  if (!currentUser) return { blocked: false, settled: false };
  const blocked = needsReconsent(currentUser);
  return { blocked, settled: !blocked };
}
