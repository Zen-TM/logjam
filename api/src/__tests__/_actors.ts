// Multi-user test harness for the integration suite.
//
// Fake auth was historically single-user (always alice), which made the
// share-recipient and stranger perspectives "structurally infeasible" to test —
// the exact blind spot that let SEC-001 (owner-private trip data leaking to
// share recipients) ship. The fake-auth middleware now honours an `x-fake-sub`
// request header (dev only; impossible outside AUTH_MODE=fake — see
// api/src/middleware/auth.ts) so a single test process can act as any seeded
// user per request. Spread `as(SUB)` onto a supertest `.set(...)`.

export const API_URL = process.env.API_URL ?? "http://localhost:8080";

// Cognito subs of the seeded fake users (api/prisma/seed.ts).
export const ALICE_SUB = "fake-alice-sub";
export const BOB_SUB = "fake-bob-sub";
export const CAROL_SUB = "fake-carol-sub";

// Seed user row IDs (api/prisma/seed.ts).
export const ALICE_ID = "00000000-0000-0000-0000-000000000001";
export const BOB_ID = "00000000-0000-0000-0000-000000000002";
export const CAROL_ID = "00000000-0000-0000-0000-000000000003";

// Seed canyon IDs (all alice-owned). Canyons 0 and 1 are shared with bob;
// carol is shared nothing (the stranger).
export const SHARED_CANYON_ID = "10000000-0000-0000-0000-000000000001";

// Header bundle authenticating the request as `sub`. Usage:
//   request(API_URL).get("/canyons").set(as(BOB_SUB))
export function as(sub: string): Record<string, string> {
  return { Authorization: "Bearer fake-token", "x-fake-sub": sub };
}
