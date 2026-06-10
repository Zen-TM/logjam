import { describe, it, expect } from "vitest";
import { CURRENT_CONSENT_VERSION, needsReconsent } from "./consent";

// Consent is a privacy/legal boundary (root CLAUDE.md): privacy.html and
// tos.html promise "you will be asked to re-consent on next sign-in" after a
// material change. needsReconsent is the predicate that makes a
// CURRENT_CONSENT_VERSION bump actually reach existing users.
describe("needsReconsent", () => {
  it("returns true for a user who has never consented (consentVersion null)", () => {
    expect(needsReconsent({ consentVersion: null })).toBe(true);
  });

  it("returns true for a stale consent version", () => {
    expect(needsReconsent({ consentVersion: "2025-01-01" })).toBe(true);
  });

  it("returns false when the recorded version matches the current constant", () => {
    expect(needsReconsent({ consentVersion: CURRENT_CONSENT_VERSION })).toBe(
      false,
    );
  });

  it("respects an explicit currentVersion argument", () => {
    expect(needsReconsent({ consentVersion: "2030-01-01" }, "2030-01-01")).toBe(
      false,
    );
    expect(
      needsReconsent({ consentVersion: CURRENT_CONSENT_VERSION }, "2030-01-01"),
    ).toBe(true);
  });
});
