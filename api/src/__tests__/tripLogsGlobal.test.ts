import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL, as, CAROL_SUB } from "./_actors";

// Integration coverage for GET /trips (routes/tripLogsGlobal.ts), previously
// untested (CH-003, 2026-06-22). Focus: the UX-001 X-Total-Count header, the
// search/date filters, and owner isolation (a stranger never sees another
// user's trips). Requires `make dev` (AUTH_MODE=fake; no header = alice).
const AUTH = { Authorization: "Bearer fake-token" } as const;

// Unique token per run so search filters and cleanup never collide with seed
// data or a previous run's leftovers.
const TAG = `CH003-global-${Date.now()}`;

async function createCanyon(name: string, auth = AUTH): Promise<string> {
  const res = await request(API_URL)
    .post("/canyons")
    .set(auth)
    .send({ name, latitude: -33.7, longitude: 150.3 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function createTrip(
  canyonId: string,
  date: string,
  auth = AUTH,
): Promise<string> {
  const res = await request(API_URL)
    .post("/trips")
    .set(auth)
    .send({ canyonId, date });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("GET /trips (global trip list, fake auth = alice)", () => {
  it("sets X-Total-Count and, under the 500 cap, it equals the returned array length", async () => {
    const canyonId = await createCanyon(`${TAG}-count`);
    try {
      await createTrip(canyonId, "2024-03-15");
      await createTrip(canyonId, "2024-03-16");

      const res = await request(API_URL).get("/trips").set(AUTH);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const header = res.headers["x-total-count"];
      expect(header).toBeDefined();
      const total = Number(header);
      expect(Number.isNaN(total)).toBe(false);
      // The owner's full set is well under the 500 cap in a test DB, so the
      // bare-array body is not truncated and its length equals the true total.
      expect(total).toBe(res.body.length);
      expect(total).toBeGreaterThanOrEqual(2);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });

  it("search filter narrows to the matching canyon name and X-Total-Count tracks the filtered set", async () => {
    const uniqueName = `${TAG}-search`;
    const canyonId = await createCanyon(uniqueName);
    try {
      await createTrip(canyonId, "2024-03-15");

      const res = await request(API_URL)
        .get("/trips")
        .query({ search: uniqueName })
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].canyon.name).toBe(uniqueName);
      // Header reflects the FILTERED count, not the whole account (UX-001).
      expect(Number(res.headers["x-total-count"])).toBe(1);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });

  it("dateFrom/dateTo filter bounds the results inclusively", async () => {
    const uniqueName = `${TAG}-dates`;
    const canyonId = await createCanyon(uniqueName);
    try {
      await createTrip(canyonId, "2024-01-10");
      await createTrip(canyonId, "2024-02-10");
      await createTrip(canyonId, "2024-03-10");

      const res = await request(API_URL)
        .get("/trips")
        .query({ search: uniqueName, dateFrom: "2024-02-01", dateTo: "2024-02-28" })
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].date.startsWith("2024-02-10")).toBe(true);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });

  it("owner isolation: a stranger (carol) never sees alice's trips", async () => {
    const uniqueName = `${TAG}-isolation`;
    const canyonId = await createCanyon(uniqueName);
    try {
      await createTrip(canyonId, "2024-03-15");

      const res = await request(API_URL)
        .get("/trips")
        .query({ search: uniqueName })
        .set(as(CAROL_SUB));
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
      expect(Number(res.headers["x-total-count"])).toBe(0);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });
});
