// Thin re-export — the canonical consent version and needsReconsent() live in
// shared/src/consent.ts so api and frontend can never diverge again
// (they did on 2026-06-11: "Invalid consentVersion" in prod).
import { CURRENT_CONSENT_VERSION, needsReconsent } from "@logjam/shared";

export { CURRENT_CONSENT_VERSION, needsReconsent };

export const PENDING_CONSENT_STORAGE_KEY = "logjam.pendingConsentVersion";

/**
 * The single consent decision, used twice: to render ConsentGate INSTEAD of the
 * app, and to hold every `enabled=authenticated` data hook and boot effect
 * until consent is settled (FECO-005 — the gate blocked the UI but not the
 * app's own API traffic, so a stale-consent user's canyons, trips, friends and
 * notifications were fetched before they agreed).
 *
 * Two callers, one derivation, on purpose: a gate that renders on a different
 * condition than the one holding the fetches is the bug this replaces.
 *
 * `blocked` and `settled` are not opposites — while `currentUser` is still
 * loading neither is true, which is what makes the prefetches wait rather than
 * race the answer.
 */
export function consentGate(
  currentUser: { consentVersion: string | null } | null,
  pendingConsentVersion: string | null,
): { blocked: boolean; settled: boolean } {
  // Nothing to decide from yet. Not blocked (no gate flash before we know),
  // not settled (no fetches until we do).
  if (!currentUser) return { blocked: false, settled: false };
  // A pending version matching the current one is a consent just given on the
  // sign-up form and not yet recorded server-side. Gating on it would trap a
  // brand-new user behind a gate for a box they already ticked.
  const blocked =
    needsReconsent(currentUser) && pendingConsentVersion !== CURRENT_CONSENT_VERSION;
  return { blocked, settled: !blocked };
}
