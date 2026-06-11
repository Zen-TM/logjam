// Thin re-export — the canonical consent version lives in
// shared/src/consent.ts so api and frontend can never diverge again
// (they did on 2026-06-11: "Invalid consentVersion" in prod).
export { CURRENT_CONSENT_VERSION } from "@logjam/shared";
