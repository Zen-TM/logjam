import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL, as, BOB_SUB, CAROL_SUB } from "./_actors";

const CAROL = as(CAROL_SUB);

// Integration coverage for routes/tripLogsGlobal.ts — GET /trips (list),
// GET /trips/:id, POST /trips, PATCH /trips/:id, DELETE /trips/:id. Covers
// the trip↔canyon m2m contract: canyons: {id,name}[] (join-order), the
// independent optional displayName/types fields, canyonIds validation
// (ownership/dupes/cap), and search-by-linked-canyon-name. Requires
// `make dev` (AUTH_MODE=fake; no header = alice).
//
// Canyon deletion no longer cascades a linked trip away (trips survive with
// their join rows detached) — every test that links a trip to a canyon must
// explicitly DELETE /trips/:id in addition to DELETE /canyons/:id.
const AUTH = { Authorization: "Bearer fake-token" } as const;

const TAG = `CH003-global-${Date.now()}`;
const NONEXISTENT_ID = "99999999-9999-9999-9999-999999999999";

async function createCanyon(name: string, auth = AUTH): Promise<string> {
  const res = await request(API_URL)
    .post("/canyons")
    .set(auth)
    .send({ name, latitude: -33.7, longitude: 150.3 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function deleteCanyon(id: string, auth = AUTH): Promise<void> {
  await request(API_URL).delete(`/canyons/${id}`).set(auth);
}

async function deleteTrip(id: string, auth = AUTH): Promise<void> {
  await request(API_URL).delete(`/trips/${id}`).set(auth);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createTrip(body: Record<string, any>, auth = AUTH) {
  const res = await request(API_URL).post("/trips").set(auth).send(body);
  expect(res.status).toBe(201);
  return res.body as {
    id: string;
    canyons: { id: string; name: string }[];
    displayName: string | null;
    types: string[];
  };
}

describe("GET /trips (global trip list, fake auth = alice)", () => {
  it("sets X-Total-Count and, under the 500 cap, it equals the returned array length", async () => {
    const canyonId = await createCanyon(`${TAG}-count`);
    const t1 = await createTrip({ canyonIds: [canyonId], date: "2024-03-15" });
    const t2 = await createTrip({ canyonIds: [canyonId], date: "2024-03-16" });
    try {
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
      await deleteTrip(t1.id);
      await deleteTrip(t2.id);
      await deleteCanyon(canyonId);
    }
  });

  it("search filter narrows to the matching linked canyon name and X-Total-Count tracks the filtered set", async () => {
    const uniqueName = `${TAG}-search`;
    const canyonId = await createCanyon(uniqueName);
    const trip = await createTrip({ canyonIds: [canyonId], date: "2024-03-15" });
    try {
      const res = await request(API_URL)
        .get("/trips")
        .query({ search: uniqueName })
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].canyons).toEqual([{ id: canyonId, name: uniqueName }]);
      // Header reflects the FILTERED count, not the whole account (UX-001).
      expect(Number(res.headers["x-total-count"])).toBe(1);
    } finally {
      await deleteTrip(trip.id);
      await deleteCanyon(canyonId);
    }
  });

  it("search filter also matches by displayName (not just linked canyon name)", async () => {
    const uniqueName = `${TAG}-search-displayname`;
    const trip = await createTrip({ date: "2024-03-17", displayName: uniqueName });
    try {
      const res = await request(API_URL)
        .get("/trips")
        .query({ search: uniqueName })
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(trip.id);
      expect(res.body[0].canyons).toEqual([]);
    } finally {
      await deleteTrip(trip.id);
    }
  });

  it("dateFrom/dateTo filter bounds the results inclusively", async () => {
    const uniqueName = `${TAG}-dates`;
    const canyonId = await createCanyon(uniqueName);
    const t1 = await createTrip({ canyonIds: [canyonId], date: "2024-01-10" });
    const t2 = await createTrip({ canyonIds: [canyonId], date: "2024-02-10" });
    const t3 = await createTrip({ canyonIds: [canyonId], date: "2024-03-10" });
    try {
      const res = await request(API_URL)
        .get("/trips")
        .query({ search: uniqueName, dateFrom: "2024-02-01", dateTo: "2024-02-28" })
        .set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].date.startsWith("2024-02-10")).toBe(true);
    } finally {
      await deleteTrip(t1.id);
      await deleteTrip(t2.id);
      await deleteTrip(t3.id);
      await deleteCanyon(canyonId);
    }
  });

  it("owner isolation: a stranger (carol) never sees alice's trips", async () => {
    const uniqueName = `${TAG}-isolation`;
    const canyonId = await createCanyon(uniqueName);
    const trip = await createTrip({ canyonIds: [canyonId], date: "2024-03-15" });
    try {
      const res = await request(API_URL)
        .get("/trips")
        .query({ search: uniqueName })
        .set(as(CAROL_SUB));
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
      expect(Number(res.headers["x-total-count"])).toBe(0);
    } finally {
      await deleteTrip(trip.id);
      await deleteCanyon(canyonId);
    }
  });
});

describe("POST /trips (acting as carol — spreads the per-user rate-limit budget)", () => {
  it("a bare {date} trip is valid — canyon-XOR-displayName exclusion was removed", async () => {
    const trip = await createTrip({ date: "2026-06-05" }, CAROL);
    try {
      expect(trip.canyons).toEqual([]);
      expect(trip.displayName).toBeNull();
      expect(trip.types).toEqual([]);
    } finally {
      await deleteTrip(trip.id, CAROL);
    }
  });

  it("rejects a missing date with 400", async () => {
    const res = await request(API_URL).post("/trips").set(CAROL).send({});
    expect(res.status).toBe(400);
  });

  it("3 canyonIds come back as canyons[] in the same order", async () => {
    const a = await createCanyon(`${TAG}-order-A`, CAROL);
    const b = await createCanyon(`${TAG}-order-B`, CAROL);
    const c = await createCanyon(`${TAG}-order-C`, CAROL);
    const trip = await createTrip({ canyonIds: [c, a, b], date: "2026-06-06" }, CAROL);
    try {
      expect(trip.canyons.map((x) => x.id)).toEqual([c, a, b]);
    } finally {
      await deleteTrip(trip.id, CAROL);
      await deleteCanyon(a, CAROL);
      await deleteCanyon(b, CAROL);
      await deleteCanyon(c, CAROL);
    }
  });

  it("displayName and canyonIds coexist on one trip", async () => {
    const canyonId = await createCanyon(`${TAG}-coexist`, CAROL);
    const trip = await createTrip({
      canyonIds: [canyonId],
      date: "2026-06-07",
      displayName: "custom title",
      types: ["canyoning"],
    }, CAROL);
    try {
      expect(trip.displayName).toBe("custom title");
      expect(trip.types).toEqual(["canyoning"]);
      expect(trip.canyons).toEqual([{ id: canyonId, name: `${TAG}-coexist` }]);
    } finally {
      await deleteTrip(trip.id, CAROL);
      await deleteCanyon(canyonId, CAROL);
    }
  });

  describe("canyonIds validation", () => {
    it("a foreign (bob's) canyon id is rejected with 400 that does not echo the id", async () => {
      const bobCanyonId = await createCanyon(`${TAG}-bob-foreign`, as(BOB_SUB));
      try {
        const res = await request(API_URL)
          .post("/trips")
          .set(CAROL)
          .send({ date: "2026-06-08", canyonIds: [bobCanyonId] });
        expect(res.status).toBe(400);
        expect(String(res.body.error)).not.toContain(bobCanyonId);
      } finally {
        await deleteCanyon(bobCanyonId, as(BOB_SUB));
      }
    });

    it("duplicate canyon ids are rejected with 400", async () => {
      const canyonId = await createCanyon(`${TAG}-dupe`, CAROL);
      try {
        const res = await request(API_URL)
          .post("/trips")
          .set(CAROL)
          .send({ date: "2026-06-09", canyonIds: [canyonId, canyonId] });
        expect(res.status).toBe(400);
      } finally {
        await deleteCanyon(canyonId, CAROL);
      }
    });

    it("more than 20 canyon ids are rejected with 400 (cap check runs before ownership lookup)", async () => {
      const canyonIds = Array.from({ length: 21 }, (_, i) => `not-a-real-id-${i}`);
      const res = await request(API_URL)
        .post("/trips")
        .set(CAROL)
        .send({ date: "2026-06-10", canyonIds });
      expect(res.status).toBe(400);
    });
  });

  describe("types validation", () => {
    it("sets types on create", async () => {
      const trip = await createTrip({ date: "2026-06-11", types: ["bushwalking"] }, CAROL);
      try {
        expect(trip.types).toEqual(["bushwalking"]);
      } finally {
        await deleteTrip(trip.id, CAROL);
      }
    });

    it("rejects a type longer than 40 characters with 400", async () => {
      const res = await request(API_URL)
        .post("/trips")
        .set(CAROL)
        .send({ date: "2026-06-12", types: ["x".repeat(41)] });
      expect(res.status).toBe(400);
    });

    it("multi-type create round-trips ordered", async () => {
      const trip = await createTrip(
        { date: "2026-06-21", types: ["canyoning", "bushwalking", "packrafting"] },
        CAROL,
      );
      try {
        expect(trip.types).toEqual(["canyoning", "bushwalking", "packrafting"]);
      } finally {
        await deleteTrip(trip.id, CAROL);
      }
    });

    it("case-insensitive duplicate types are rejected with 400", async () => {
      const res = await request(API_URL)
        .post("/trips")
        .set(CAROL)
        .send({ date: "2026-06-22", types: ["Canyoning", "canyoning"] });
      expect(res.status).toBe(400);
    });

    it("more than 10 types are rejected with 400", async () => {
      const types = Array.from({ length: 11 }, (_, i) => `type-${i}`);
      const res = await request(API_URL)
        .post("/trips")
        .set(CAROL)
        .send({ date: "2026-06-23", types });
      expect(res.status).toBe(400);
    });
  });
});

describe("PATCH /trips/:id (acting as carol — spreads the per-user rate-limit budget)", () => {
  it("reordering canyonIds changes the order of canyons[]", async () => {
    const a = await createCanyon(`${TAG}-reorder-A`, CAROL);
    const b = await createCanyon(`${TAG}-reorder-B`, CAROL);
    const trip = await createTrip({ canyonIds: [a, b], date: "2026-06-13" }, CAROL);
    try {
      const patchRes = await request(API_URL)
        .patch(`/trips/${trip.id}`)
        .set(CAROL)
        .send({ canyonIds: [b, a] });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.canyons.map((x: { id: string }) => x.id)).toEqual([b, a]);
    } finally {
      await deleteTrip(trip.id, CAROL);
      await deleteCanyon(a, CAROL);
      await deleteCanyon(b, CAROL);
    }
  });

  it("replacing canyonIds with a disjoint set fully replaces the linked canyons", async () => {
    const a = await createCanyon(`${TAG}-replace-A`, CAROL);
    const b = await createCanyon(`${TAG}-replace-B`, CAROL);
    const trip = await createTrip({ canyonIds: [a], date: "2026-06-14" }, CAROL);
    try {
      const patchRes = await request(API_URL)
        .patch(`/trips/${trip.id}`)
        .set(CAROL)
        .send({ canyonIds: [b] });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.canyons).toEqual([{ id: b, name: `${TAG}-replace-B` }]);
    } finally {
      await deleteTrip(trip.id, CAROL);
      await deleteCanyon(a, CAROL);
      await deleteCanyon(b, CAROL);
    }
  });

  it("canyonIds: [] clears the linked canyons", async () => {
    const canyonId = await createCanyon(`${TAG}-clear-canyons`, CAROL);
    const trip = await createTrip({ canyonIds: [canyonId], date: "2026-06-15" }, CAROL);
    try {
      const patchRes = await request(API_URL)
        .patch(`/trips/${trip.id}`)
        .set(CAROL)
        .send({ canyonIds: [] });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.canyons).toEqual([]);
    } finally {
      await deleteTrip(trip.id, CAROL);
      await deleteCanyon(canyonId, CAROL);
    }
  });

  it("explicit displayName: null clears a previously-set displayName", async () => {
    const trip = await createTrip({ date: "2026-06-16", displayName: "will be cleared" }, CAROL);
    try {
      expect(trip.displayName).toBe("will be cleared");
      const patchRes = await request(API_URL)
        .patch(`/trips/${trip.id}`)
        .set(CAROL)
        .send({ displayName: null });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.displayName).toBeNull();
    } finally {
      await deleteTrip(trip.id, CAROL);
    }
  });

  it("explicit types: null clears a previously-set types list", async () => {
    const trip = await createTrip({ date: "2026-06-17", types: ["canyoning"] }, CAROL);
    try {
      const patchRes = await request(API_URL)
        .patch(`/trips/${trip.id}`)
        .set(CAROL)
        .send({ types: null });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.types).toEqual([]);
    } finally {
      await deleteTrip(trip.id, CAROL);
    }
  });

  it("a foreign canyon id on PATCH is rejected with 400 and the existing link is untouched", async () => {
    const ownCanyon = await createCanyon(`${TAG}-patch-own`, CAROL);
    const bobCanyonId = await createCanyon(`${TAG}-patch-bob`, as(BOB_SUB));
    const trip = await createTrip({ canyonIds: [ownCanyon], date: "2026-06-18" }, CAROL);
    try {
      const patchRes = await request(API_URL)
        .patch(`/trips/${trip.id}`)
        .set(CAROL)
        .send({ canyonIds: [bobCanyonId] });
      expect(patchRes.status).toBe(400);

      const getRes = await request(API_URL).get(`/trips/${trip.id}`).set(CAROL);
      expect(getRes.body.canyons).toEqual([{ id: ownCanyon, name: `${TAG}-patch-own` }]);
    } finally {
      await deleteTrip(trip.id, CAROL);
      await deleteCanyon(ownCanyon, CAROL);
      await deleteCanyon(bobCanyonId, as(BOB_SUB));
    }
  });
});

describe("GET /trips/:id (acting as carol — spreads the per-user rate-limit budget)", () => {
  it("owner reads notes, customFields and media on their own trip", async () => {
    const trip = await createTrip(
      {
        date: "2026-06-19",
        notes: "single-GET owner notes",
        customFields: { anchors: "detail" },
      },
      CAROL,
    );
    try {
      const res = await request(API_URL).get(`/trips/${trip.id}`).set(CAROL);
      expect(res.status).toBe(200);
      expect(res.body.notes).toBe("single-GET owner notes");
      expect(res.body.customFields).toEqual({ anchors: "detail" });
      expect(Array.isArray(res.body.media)).toBe(true);
    } finally {
      await deleteTrip(trip.id, CAROL);
    }
  });

  it("a non-owner (bob) gets 404, not the trip owner's data (SEC-001: no ID oracle)", async () => {
    const trip = await createTrip({ date: "2026-06-20", notes: "owner-private" }, CAROL);
    try {
      const res = await request(API_URL).get(`/trips/${trip.id}`).set(as(BOB_SUB));
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("owner-private");
    } finally {
      await deleteTrip(trip.id, CAROL);
    }
  });

  it("404s for a non-existent trip id", async () => {
    const res = await request(API_URL).get(`/trips/${NONEXISTENT_ID}`).set(CAROL);
    expect(res.status).toBe(404);
  });
});

// APIR-011: malformed query params reached Prisma as an Invalid Date and came
// back as a 500 for what is plain bad input (the bulk import path has always
// rejected unparseable dates with a 400).
describe("GET /trips — query param validation", () => {
  it("400s on an unparseable dateFrom/dateTo instead of 500ing", async () => {
    for (const query of [{ dateFrom: "garbage" }, { dateTo: "2024-13-45x" }]) {
      const res = await request(API_URL).get("/trips").query(query).set(AUTH);
      expect(res.status).toBe(400);
    }
  });

  it("400s on a repeated param that arrives as an array", async () => {
    const res = await request(API_URL)
      .get("/trips?dateFrom=2024-01-01&dateFrom=2024-02-01")
      .set(AUTH);
    expect(res.status).toBe(400);
  });

  it("still accepts a well-formed date range", async () => {
    const res = await request(API_URL)
      .get("/trips")
      .query({ dateFrom: "2024-01-01", dateTo: "2024-12-31" })
      .set(AUTH);
    expect(res.status).toBe(200);
  });
});

