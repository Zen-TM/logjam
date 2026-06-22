import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL, as, CAROL_SUB } from "./_actors";

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
    heroStats: { totalTrips: number; uniqueCanyons: number; daysCanyoning: number; totalAbseils: number | null };
    completion: { totalCanyons: number; canyonsWithTrips: number };
    tripDates: Record<string, number>;
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
    try {
      const tripRes = await request(API_URL)
        .post("/trips")
        .set(AUTH)
        .send({ canyonId, date: DELTA_DATE });
      expect(tripRes.status).toBe(201);

      // tripDates is keyed by date; the controlled far-future date isolates this
      // assertion from concurrent writes to alice's other dates.
      const after = await getAnalytics();
      expect(after.tripDates[DELTA_DATE]).toBe(1);
    } finally {
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
    try {
      const tripRes = await request(API_URL)
        .post("/trips")
        .set(AUTH)
        .send({ canyonId, date: ISOLATION_DATE });
      expect(tripRes.status).toBe(201);

      // carol logged nothing on this date — alice's activity must not bleed in.
      const carol = await getAnalytics(as(CAROL_SUB));
      expect(carol.tripDates[ISOLATION_DATE]).toBeUndefined();
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });
});
