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

async function getAnalytics(auth = AUTH) {
  const res = await request(API_URL).get("/analytics").set(auth);
  expect(res.status).toBe(200);
  return res.body as {
    heroStats: {
      totalTrips: number;
      uniqueCanyons: number;
      daysCanyoning: number;
      totalAbseils: number | null;
    };
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

  it("counts a trip by its canyon LINK regardless of tag; totalAbseils sums every linked canyon of each counted trip", async () => {
    // Acts as bob (no seeded trips) — spreads the suite across per-user
    // rate-limit buckets. Assertions are deltas around this test's own writes:
    // hero stats are now link-driven, so there is no per-run type tag left to
    // isolate them with (the old ?type= trick).
    // TripLog types entries cap at 40 chars — keep run-unique tags short.
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

    const before = await getAnalytics(BOB);

    // Two canyon-linked trips, NEITHER tagged by the client — the case the
    // whole fix exists for. One multi-canyon (A and B), one single (A only).
    const tripMulti = await request(API_URL)
      .post("/trips")
      .set(BOB)
      .send({ canyonIds: [canyonAId, canyonBId], date: "2099-03-01" });
    expect(tripMulti.status).toBe(201);
    // POST force-tags a canyon-linked trip (enforceCanyoningTag).
    expect(tripMulti.body.types).toEqual(["canyoning"]);

    const tripSingle = await request(API_URL)
      .post("/trips")
      .set(BOB)
      .send({ canyonIds: [canyonAId], date: "2099-03-02" });
    expect(tripSingle.status).toBe(201);

    // A canyon-less, non-canyoning trip: excluded from the hero stats, but it
    // DOES appear in the all-types Activity calendar (tripDates). Never
    // force-tagged (no link).
    const tripBushwalk = await request(API_URL)
      .post("/trips")
      .set(BOB)
      .send({ date: "2099-03-03", types: [bushwalkingType] });
    expect(tripBushwalk.status).toBe(201);
    expect(tripBushwalk.body.types).toEqual([bushwalkingType]);

    const tripIds = [tripMulti.body.id, tripSingle.body.id, tripBushwalk.body.id] as string[];
    try {
      const after = await getAnalytics(BOB);

      // Hero stats are canyoning-scoped: the two linked trips count, the
      // bushwalking one doesn't.
      expect(after.heroStats.totalTrips - before.heroStats.totalTrips).toBe(2);
      // totalAbseils sums numAbseils over every linked canyon of each counted
      // trip: tripMulti contributes 3+5, tripSingle contributes 3.
      expect(
        (after.heroStats.totalAbseils ?? 0) - (before.heroStats.totalAbseils ?? 0),
      ).toBe(3 + 5 + 3);
      // uniqueCanyons counts every distinct linked canyon id: A and B.
      expect(after.heroStats.uniqueCanyons - before.heroStats.uniqueCanyons).toBe(2);

      // tripDates counts ALL trips (the Activity calendar), so the bushwalking
      // trip lands in its bucket too — unlike the hero stats above. Far-future
      // dates isolate the buckets from concurrent writes elsewhere.
      expect(after.tripDates["2099-03-01"]).toBe(1);
      expect(after.tripDates["2099-03-02"]).toBe(1);
      expect(after.tripDates["2099-03-03"]).toBe(1);

      // types[] lists every distinct type across ALL trips, canyoning or not.
      expect(after.types).toContain("canyoning");
      expect(after.types).toContain(bushwalkingType);
    } finally {
      for (const id of tripIds) {
        await request(API_URL).delete(`/trips/${id}`).set(BOB);
      }
      await request(API_URL).delete(`/canyons/${canyonAId}`).set(BOB);
      await request(API_URL).delete(`/canyons/${canyonBId}`).set(BOB);
    }
  });

  it("counts a canyon-less trip tagged canyoning — the 'canyon that isn't in my library' escape hatch", async () => {
    const before = await getAnalytics(BOB);
    // No canyonIds: the link branch can't match, so only the tag branch counts
    // this trip. uniqueCanyons picks it up by displayName.
    const trip = await request(API_URL)
      .post("/trips")
      .set(BOB)
      .send({ date: "2099-04-01", types: ["canyoning"], displayName: `${TAG}-unlisted` });
    expect(trip.status).toBe(201);
    const tripId = trip.body.id as string;
    try {
      const after = await getAnalytics(BOB);
      expect(after.heroStats.totalTrips - before.heroStats.totalTrips).toBe(1);
      expect(after.heroStats.uniqueCanyons - before.heroStats.uniqueCanyons).toBe(1);
      expect(after.tripDates["2099-04-01"]).toBe(1);
    } finally {
      await request(API_URL).delete(`/trips/${tripId}`).set(BOB);
    }
  });
});
