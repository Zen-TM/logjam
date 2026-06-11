// Thin re-export — the canonical consent version and needsReconsent() live in
// shared/src/consent.ts so api and frontend can never diverge again
// (they did on 2026-06-11: "Invalid consentVersion" in prod).
export { CURRENT_CONSENT_VERSION, needsReconsent } from "@logjam/shared";

export const PENDING_CONSENT_STORAGE_KEY = "logjam.pendingConsentVersion";
