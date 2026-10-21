import { describe, it, expect } from "vitest";
import {
  CURRENT_CONSENT_VERSION,
  currentConsentVersionOf,
  needsReconsent,
} from "./consent.js";

// Consent is a privacy/legal boundary (root AGENTS.md): privacy.html and
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

  // The server names the version; the build's constant is only the fallback.
  // Mutation: compare against CURRENT_CONSENT_VERSION in needsReconsent (or
  // return it from currentConsentVersionOf) and this turns red: a bump would
  // strand every installed build at a gate whose Agree the server refuses.
  it("compares with the server's version, not the build's constant", () => {
    expect(
      needsReconsent({
        consentVersion: CURRENT_CONSENT_VERSION,
        currentConsentVersion: "2999-01-01",
      }),
    ).toBe(true);
    expect(
      needsReconsent({
        consentVersion: "2999-01-01",
        currentConsentVersion: "2999-01-01",
      }),
    ).toBe(false);
  });

  // Mutation: drop the `?? CURRENT_CONSENT_VERSION` in currentConsentVersionOf.
  it("falls back to the build's constant against a server that sends no version", () => {
    expect(
      needsReconsent({
        consentVersion: "2025-01-01",
        currentConsentVersion: undefined,
      }),
    ).toBe(true);
    expect(currentConsentVersionOf({})).toBe(CURRENT_CONSENT_VERSION);
  });

  // Mutation: return CURRENT_CONSENT_VERSION from currentConsentVersionOf.
  it("names the version a gate must send back", () => {
    expect(
      currentConsentVersionOf({ currentConsentVersion: "2999-01-01" }),
    ).toBe("2999-01-01");
  });
});
