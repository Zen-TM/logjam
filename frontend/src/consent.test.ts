import { describe, expect, it } from "vitest";

import { CURRENT_CONSENT_VERSION, consentGate } from "./consent";

// User-data hooks must not fetch data behind the gate (frontend/AGENTS.md).
// `settled` is what those hooks wait on, and `blocked` is what renders the gate —
// one function so the two can't drift.
describe("consentGate", () => {
  it("neither blocks nor releases while the current user is still loading", () => {
    expect(consentGate(null)).toEqual({ blocked: false, settled: false });
  });

  it("blocks a stale-consent user, and holds their data fetches", () => {
    expect(consentGate({ consentVersion: "2020-01-01" })).toEqual({
      blocked: true,
      settled: false,
    });
  });

  it("blocks a user who has never consented", () => {
    expect(consentGate({ consentVersion: null }).blocked).toBe(true);
  });

  it("releases a user whose recorded consent is current", () => {
    expect(consentGate({ consentVersion: CURRENT_CONSENT_VERSION })).toEqual({
      blocked: false,
      settled: true,
    });
  });

  // Mutation: compare with CURRENT_CONSENT_VERSION in needsReconsent (or
  // return it from currentConsentVersionOf) and this turns red.
  it("blocks on the server's version even when the recorded one matches the build's", () => {
    expect(
      consentGate({
        consentVersion: CURRENT_CONSENT_VERSION,
        currentConsentVersion: "2999-01-01",
      }).blocked,
    ).toBe(true);
  });
});
