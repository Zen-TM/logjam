import { describe, expect, it } from "vitest";

import { CURRENT_CONSENT_VERSION, consentGate } from "./consent";

// User-data hooks must not fetch data behind the gate (frontend/AGENTS.md).
// `settled` is what those hooks wait on, and `blocked` is what renders the gate —
// one function so the two can't drift.
describe("consentGate", () => {
  it("neither blocks nor releases while the current user is still loading", () => {
    expect(consentGate(null, null)).toEqual({ blocked: false, settled: false });
  });

  it("blocks a stale-consent user, and holds their data fetches", () => {
    expect(consentGate({ consentVersion: "2020-01-01" }, null)).toEqual({
      blocked: true,
      settled: false,
    });
  });

  it("blocks a user who has never consented", () => {
    expect(consentGate({ consentVersion: null }, null).blocked).toBe(true);
  });

  it("releases a user whose recorded consent is current", () => {
    expect(
      consentGate({ consentVersion: CURRENT_CONSENT_VERSION }, null),
    ).toEqual({
      blocked: false,
      settled: true,
    });
  });

  it("releases a fresh sign-up whose consent is pending but not yet recorded", () => {
    // The box was ticked on the sign-up form; the PATCH recording it is in
    // flight. Blocking here would gate a brand-new user on their own answer.
    expect(
      consentGate({ consentVersion: null }, CURRENT_CONSENT_VERSION),
    ).toEqual({
      blocked: false,
      settled: true,
    });
  });

  // Mutation: compare with CURRENT_CONSENT_VERSION in needsReconsent (or
  // return it from currentConsentVersionOf) and this turns red.
  it("blocks on the server's version even when the recorded one matches the build's", () => {
    expect(
      consentGate(
        {
          consentVersion: CURRENT_CONSENT_VERSION,
          currentConsentVersion: "2999-01-01",
        },
        null,
      ).blocked,
    ).toBe(true);
  });

  // Mutation: match the pending value against CURRENT_CONSENT_VERSION in
  // consentGate (or return it from currentConsentVersionOf) and this turns red.
  it("releases a fresh sign-up whose pending version is the server's, not the build's", () => {
    expect(
      consentGate(
        { consentVersion: null, currentConsentVersion: "2999-01-01" },
        "2999-01-01",
      ).blocked,
    ).toBe(false);
  });

  it("ignores a pending value left over from an older consent version", () => {
    expect(consentGate({ consentVersion: null }, "2020-01-01").blocked).toBe(
      true,
    );
  });
});
