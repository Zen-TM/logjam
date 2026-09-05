// Multi-user test harness for the integration suite.
//
// Fake auth was historically single-user (always alice), which made the
// share-recipient and stranger perspectives "structurally infeasible" to test —
// the exact blind spot that let SEC-001 (owner-private trip data leaking to
// share recipients) ship. The fake-auth middleware now honours an `x-fake-sub`
// request header (dev only; impossible outside AUTH_MODE=fake — see
// api/src/middleware/auth.ts) so a single test process can act as any seeded
// user per request. Spread `as(SUB)` onto a supertest `.set(...)`.

import { SYSTEM_PLACE_TYPE_IDS } from "@logjam/shared";

export const API_URL = process.env.API_URL ?? "http://localhost:8080";

// Cognito subs of the seeded fake users (api/prisma/seed.ts).
export const ALICE_SUB = "fake-alice-sub";
export const BOB_SUB = "fake-bob-sub";
export const CAROL_SUB = "fake-carol-sub";

// Seed user row IDs (api/prisma/seed.ts — these mirror its `seedId` helper and
// like it MUST stay real UUIDv4s; see src/lib/seedIds.unit.test.ts).
export const ALICE_ID = "00000000-0000-4000-8000-000000000001";
export const BOB_ID = "00000000-0000-4000-8000-000000000002";
export const CAROL_ID = "00000000-0000-4000-8000-000000000003";

// Seed place IDs (all alice-owned). Places 0 and 1 are shared with bob;
// carol is shared nothing (the stranger).
export const SHARED_PLACE_ID = "10000000-0000-4000-8000-000000000001";

// What bob shares WITH alice — bob's "Coin Slot" place and one waypoint. Named
// here rather than assumed absent: the seed grew an incoming share for alice
// (so the phone's sharee-perspective surfaces are reachable in dev) and three
// tests in friendShares.test.ts were asserting her received list was EMPTY.
// They passed for as long as the seed had no incoming shares, and the header
// comment stating that baseline was the only thing linking the two — which is
// how a seed change broke a suite that is not in CI. Assert against these
// instead of against `[]`, so the next seed change fails loudly here.
export const BOB_SHARED_PLACE_ID = "20000000-0000-4000-8000-000000000002";
export const BOB_SHARED_WAYPOINT_ID = "60000000-0000-4000-8000-000000000005";

// The system Canyon type. Every fixture that creates a place names a type,
// because the API refuses one without — deliberately: a silent default would
// file a campsite under canyons, where the user would never look for it, and
// the request would look like it had worked.
//
// Re-exported from the shared declaration rather than restated as a literal,
// so a change to the pinned id cannot leave the suite creating places of a
// type that does not exist.
export { SYSTEM_PLACE_TYPE_IDS } from "@logjam/shared";
export const CANYON_TYPE_ID = SYSTEM_PLACE_TYPE_IDS.canyon;

// Well-formed UUIDv4 that no seeded row uses — the "unknown id" probe, so a
// 404 assertion is testing not-found and not id-format rejection.
export const NONEXISTENT_ID = "99999999-9999-4999-8999-999999999999";

// Header bundle authenticating the request as `sub`. Usage:
//   request(API_URL).get("/places").set(as(BOB_SUB))
export function as(sub: string): Record<string, string> {
  return { Authorization: "Bearer fake-token", "x-fake-sub": sub };
}
