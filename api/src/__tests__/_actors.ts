// Multi-user test harness for the integration suite.
//
// The fake-auth middleware honours an `x-fake-sub` request header (dev only;
// impossible outside AUTH_MODE=fake — see api/src/middleware/auth.ts) so a
// single test process can act as any seeded user per request. Spread `as(SUB)`
// onto a supertest `.set(...)`.

import { SYSTEM_PLACE_TYPE_IDS } from "@logjam/shared";
import {
  BOB_SHARED_PLACE_ID,
  BOB_SHARED_ROUTE_ID,
  BOB_SHARED_TOPO_JOB_ID,
} from "../../prisma/seedIds";

export const API_URL = process.env.API_URL ?? "http://localhost:8080";

// Cognito subs of the seeded fake users (api/prisma/seed.ts).
export const ALICE_SUB = "fake-alice-sub";
export const BOB_SUB = "fake-bob-sub";
export const CAROL_SUB = "fake-carol-sub";

// Seed row ids come from the seed's own declaration (prisma/seedIds.ts), so a
// test cannot name a row the seed does not write.
export {
  ALICE_ID,
  BOB_ID,
  CAROL_ID,
  SHARED_PLACE_ID,
  BOB_SHARED_PLACE_ID,
  BOB_MARKER_PLACE_ID,
  BOB_SHARED_ROUTE_ID,
  BOB_SHARED_TOPO_JOB_ID,
  SEED_PLAN_ID,
  PLAN_PLACE_ID,
  PLAN_ROUTE_ID,
  CAROL_PLAN_ID,
} from "../../prisma/seedIds";
/** Everything bob shares with alice, in the seed: the exact set the friend
 *  audit reports in each direction. */
export const BOB_SHARES_WITH_ALICE = [
  BOB_SHARED_PLACE_ID,
  BOB_SHARED_ROUTE_ID,
  BOB_SHARED_TOPO_JOB_ID,
];

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
/** The system Marker type. */
export const MARKER_TYPE_ID = SYSTEM_PLACE_TYPE_IDS.marker;

// Well-formed UUIDv4 that no seeded row uses — the "unknown id" probe, so a
// 404 assertion is testing not-found and not id-format rejection.
export const NONEXISTENT_ID = "99999999-9999-4999-8999-999999999999";

// Header bundle authenticating the request as `sub`. Usage:
//   request(API_URL).get("/places").set(as(BOB_SUB))
export function as(sub: string): Record<string, string> {
  return { Authorization: "Bearer fake-token", "x-fake-sub": sub };
}
