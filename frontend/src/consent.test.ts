import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NSW_REGION, type Region } from "@logjam/shared";

import {
  CURRENT_CONSENT_VERSION,
  consentGate,
  showsRegionStep,
} from "./consent";

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

const TWO_REGIONS: Region[] = [NSW_REGION, { ...NSW_REGION, id: "nz" }];

// App renders RegionStep on exactly this answer (App.tsx is too heavy to mount
// here); useAuth.test.tsx guards that `newAccount` is true only after a form
// sign-up.
describe("showsRegionStep", () => {
  // Mutation: return `signedUpNow` alone and the one-region case goes red.
  it("follows a form sign-up when there is a second region", () => {
    expect(showsRegionStep({ signedUpNow: true, regions: TWO_REGIONS })).toBe(
      true,
    );
    expect(showsRegionStep({ signedUpNow: true, regions: [NSW_REGION] })).toBe(
      false,
    );
  });

  // Mutation: return `offersRegionChoice(regions)` alone and this goes red.
  it("is not asked of anyone who did not just sign up", () => {
    expect(showsRegionStep({ signedUpNow: false, regions: TWO_REGIONS })).toBe(
      false,
    );
  });
});

describe("the region step after Logjam Web's own sign-up form", () => {
  // Mutation: delete App's `showsRegionStep({ signedUpNow: auth.newAccount })`
  // block, or its `finishNewAccount()`, and the form's new account is never
  // asked, or is asked again on every render.
  it("is drawn by App from useAuth's new-account flag", () => {
    const app = readFileSync(join(__dirname, "components/App.tsx"), "utf8");
    expect(app).toContain("showsRegionStep({ signedUpNow: auth.newAccount })");
    expect(app).toContain("<RegionStep");
    expect(app).toContain("auth.finishNewAccount()");
  });
});

// A hook that takes `authenticated` instead of the gate's `settled` fetches
// the user's data behind the consent gate, and nothing renders differently, so
// no render test would notice. App is too heavy to mount; this reads its
// source. Every code line that names `authenticated` is listed below: a new
// one is a new decision about whether it may run before consent settles.
//
// Mutation that turns it red: change `usePlaces(loadsUserData)` (or any hook
// beside it) to take `authenticated`, or `loadsUserData = authenticated &&
// consentSettled` to drop `consentSettled`.
describe("App hands user-data hooks the gate's settled, not authenticated", () => {
  const code = readFileSync(join(__dirname, "components/App.tsx"), "utf8")
    .split("\n")
    .map((line) => line.replace(/\s\/\/.*$/, "").trim())
    .filter((line) => !/^(\/\/|\/?\*)/.test(line) && line !== "");

  const ALLOWED = [
    // The definition, and what the whole of App waits on.
    'const authenticated = auth.state === "authenticated";',
    "const loadsUserData = authenticated && consentSettled;",
    // The consent decision itself is read from /users/me, so it cannot wait.
    "} = useCurrentUser(authenticated);",
    // The second argument is the job-poll's own sign-in check; the first is the gate.
    "} = useCompletedTopoJobs(loadsUserData, authenticated);",
    // Hydrating preferences from the user row, and the export snapshot: both
    // read what useCurrentUser already fetched.
    "if (!authenticated) return;",
    "}, [authenticated, hydrateFromUser, toast]);",
    "if (!authenticated) {",
    "}, [authenticated, topoExports, topoExportsLoading]);",
    // The signed-out screen.
    "if (!authenticated) {",
  ];

  it("names `authenticated` only where listed", () => {
    const used = code.filter((line) => /\bauthenticated\b/.test(line));
    expect(
      used.sort(),
      "src/components/App.tsx names `authenticated` on lines that differ from ALLOWED: a hook that takes it loads user data before consent settles. Pass `loadsUserData` instead; if the line truly must run before consent, add it to ALLOWED in src/consent.test.ts with the reason (and remove an entry whose line is gone).",
    ).toEqual([...ALLOWED].sort());
  });

  it("derives loadsUserData from settled, and hands it to the data hooks", () => {
    expect(code).toContain(
      "const { blocked: consentBlocked, settled: consentSettled } =",
    );
    expect(
      code.filter((l) => /\bloadsUserData\b/.test(l)).length,
    ).toBeGreaterThanOrEqual(15);
  });
});
