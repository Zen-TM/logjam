import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL, as, BOB_SUB, CAROL_SUB } from "./_actors";

const BOB = as(BOB_SUB);

// Integration coverage for GET /analytics (routes/analytics.ts), previously
// untested (CH-003, 2026-06-22). Focus: the aggregate shape, that newly created
// trips move the hero/completion counts, and owner isolation (one user's
// activity never bleeds into another's analytics). Requires `make dev`
// (AUTH_MODE=fake; no header = alice).
const AUTH = { Authorization: "Bearer fake-token" } as const;

const TAG = `CH003-analytics-${Date.now()}`;

// The integration suite runs test files in parallel against ONE DB and shared
// seed users, so global aggregate counts (totalTrips, totalCanyons) race with
// other files mutating alice. Assert instead on tripDates buckets keyed by dates
// no other test uses (far-future, distinct per test) — deterministic regardless
// of concurrent writes/deletes elsewhere.
const DELTA_DATE = "2099-01-15";
const ISOLATION_DATE = "2099-02-20";

async function getAnalytics(auth = AUTH, type?: string) {
  const res = await request(API_URL)
    .get("/analytics")
    .query(type !== undefined ? { type } : {})
    .set(auth);
  expect(res.status).toBe(200);
  return res.body as {
    heroStats: { totalTrips: number; uniqueCanyons: number; daysCanyoning: number; totalAbseils: number | null };
    completion: { totalCanyons: number; canyonsWithTrips: number };
    tripDates: Record<string, number>;
    types: string[];
  };
}

describe("GET /analytics (fake auth = alice)", () => {
  it("returns the expected aggregate shape", async () => {
    const body = await getAnalytics();
    expect(body.heroStats).toBeDefined();
    expect(typeof body.heroStats.totalTrips).toBe("number");
    expect(typeof body.heroStats.uniqueCanyons).toBe("number");
    expect(typeof body.heroStats.daysCanyoning).toBe("number");
    expect(body.completion).toBeDefined();
    expect(typeof body.completion.totalCanyons).toBe("number");
    expect(typeof body.completion.canyonsWithTrips).toBe("number");
    expect(typeof body.tripDates).toBe("object");
  });

  it("a new trip on a controlled date appears in that tripDates bucket", async () => {
    const before = await getAnalytics();
    expect(before.tripDates[DELTA_DATE]).toBeUndefined();

    const canyonRes = await request(API_URL)
      .post("/canyons")
      .set(AUTH)
      .send({ name: `${TAG}-delta`, latitude: -33.7, longitude: 150.3 });
    expect(canyonRes.status).toBe(201);
    const canyonId = canyonRes.body.id as string;
    const tripRes = await request(API_URL)
      .post("/trips")
      .set(AUTH)
      .send({ canyonIds: [canyonId], date: DELTA_DATE });
    expect(tripRes.status).toBe(201);
    const tripId = tripRes.body.id as string;
    try {
      // tripDates is keyed by date; the controlled far-future date isolates this
      // assertion from concurrent writes to alice's other dates.
      const after = await getAnalytics();
      expect(after.tripDates[DELTA_DATE]).toBe(1);
    } finally {
      await request(API_URL).delete(`/trips/${tripId}`).set(AUTH);
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });

  it("owner isolation: alice's trip on a controlled date never appears in carol's analytics", async () => {
    const canyonRes = await request(API_URL)
      .post("/canyons")
      .set(AUTH)
      .send({ name: `${TAG}-iso`, latitude: -33.7, longitude: 150.3 });
    expect(canyonRes.status).toBe(201);
    const canyonId = canyonRes.body.id as string;
    const tripRes = await request(API_URL)
      .post("/trips")
      .set(AUTH)
      .send({ canyonIds: [canyonId], date: ISOLATION_DATE });
    expect(tripRes.status).toBe(201);
    const tripId = tripRes.body.id as string;
    try {
      // carol logged nothing on this date — alice's activity must not bleed in.
      const carol = await getAnalytics(as(CAROL_SUB));
      expect(carol.tripDates[ISOLATION_DATE]).toBeUndefined();
    } finally {
      await request(API_URL).delete(`/trips/${tripId}`).set(AUTH);
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });

  it("?type= filters heroStats/tripDates to an exact TripLog.type match; types[] always lists every distinct type unfiltered; totalAbseils sums every linked canyon of each counted trip", async () => {
    // Acts as bob (no seeded trips) — keeps these exact-count assertions
    // independent of alice's ~131 migrated seed trips and spreads the suite
    // across per-user rate-limit buckets.
    // TripLog.type caps at 40 chars — keep these run-unique tags short.
    const canyoningType = `cyn-${Date.now()}`;
    const bushwalkingType = `bsh-${Date.now()}`;

    const canyonA = await request(API_URL)
      .post("/canyons")
      .set(BOB)
      .send({ name: `${TAG}-type-A`, latitude: -33.7, longitude: 150.3, numAbseils: 3 });
    expect(canyonA.status).toBe(201);
    const canyonAId = canyonA.body.id as string;

    const canyonB = await request(API_URL)
      .post("/canyons")
      .set(BOB)
      .send({ name: `${TAG}-type-B`, latitude: -33.7, longitude: 150.3, numAbseils: 5 });
    expect(canyonB.status).toBe(201);
    const canyonBId = canyonB.body.id as string;

    // Two "canyoning" trips: one multi-canyon (both A and B linked), one
    // single-canyon (A only). One "bushwalking" trip linked to B only.
    const tripMulti = await request(API_URL)
      .post("/trips")
      .set(BOB)
      .send({ canyonIds: [canyonAId, canyonBId], date: "2099-03-01", type: canyoningType });
    expect(tripMulti.status).toBe(201);
    const tripSingle = await request(API_URL)
      .post("/trips")
      .set(BOB)
      .send({ canyonIds: [canyonAId], date: "2099-03-02", type: canyoningType });
    expect(tripSingle.status).toBe(201);
    const tripBushwalk = await request(API_URL)
      .post("/trips")
      .set(BOB)
      .send({ canyonIds: [canyonBId], date: "2099-03-03", type: bushwalkingType });
    expect(tripBushwalk.status).toBe(201);

    const tripIds = [tripMulti.body.id, tripSingle.body.id, tripBushwalk.body.id] as string[];
    try {
      // Unfiltered types[] contains both tagged types regardless of ?type=.
      const unfiltered = await getAnalytics(BOB);
      expect(unfiltered.types).toContain(canyoningType);
      expect(unfiltered.types).toContain(bushwalkingType);

      // ?type= isolates the tagged type from the rest of the account (tag is
      // unique per test run, so no other trip anywhere matches it).
      const canyoningRes = await getAnalytics(BOB, canyoningType);
      expect(canyoningRes.heroStats.totalTrips).toBe(2);
      // totalAbseils sums numAbseils over every linked canyon of each counted
      // trip: tripMulti contributes 3+5, tripSingle contributes 3.
      expect(canyoningRes.heroStats.totalAbseils).toBe(3 + 5 + 3);
      // uniqueCanyons counts every distinct linked canyon id across the
      // filtered set: A and B.
      expect(canyoningRes.heroStats.uniqueCanyons).toBe(2);

      const bushwalkingRes = await getAnalytics(BOB, bushwalkingType);
      expect(bushwalkingRes.heroStats.totalTrips).toBe(1);
      expect(bushwalkingRes.heroStats.totalAbseils).toBe(5);
      expect(bushwalkingRes.heroStats.uniqueCanyons).toBe(1);
    } finally {
      for (const id of tripIds) {
        await request(API_URL).delete(`/trips/${id}`).set(BOB);
      }
      await request(API_URL).delete(`/canyons/${canyonAId}`).set(BOB);
      await request(API_URL).delete(`/canyons/${canyonBId}`).set(BOB);
    }
  });
});
