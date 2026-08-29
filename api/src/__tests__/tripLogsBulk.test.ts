import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL, as, CAROL_SUB, NONEXISTENT_ID } from "./_actors";

// Integration coverage for POST /trips/bulk (routes/tripLogsBulk.ts), previously
// untested (CH-003, 2026-06-22). Focus: the SEC-001 row-cap guards (empty 400 /
// oversized 413), the idempotent upsert-by-importKey contract, and per-row
// ownership validation. Requires `make dev` (AUTH_MODE=fake; no header = alice).
const AUTH = { Authorization: "Bearer fake-token" } as const;

const TAG = `CH003-bulk-${Date.now()}`;

// Bulk-imported trips are canyon-less with a displayName, so they surface via
// the global list search filter — use that to collect ids and clean up.
async function deleteTripsBySearch(term: string): Promise<void> {
  const list = await request(API_URL).get("/trips").query({ search: term }).set(AUTH);
  const ids = (list.body as { id: string }[]).map((t) => t.id);
  if (ids.length > 0) {
    await request(API_URL).post("/trips/bulk/delete").set(AUTH).send({ ids });
  }
}

describe("POST /trips/bulk (import, fake auth = alice)", () => {
  it("rejects an empty trips array with 400", async () => {
    const res = await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({ importBatchId: `${TAG}-empty`, trips: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a missing importBatchId with 400", async () => {
    const res = await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({ trips: [{ sourceCanyonName: "x", date: "2024-01-01" }] });
    expect(res.status).toBe(400);
  });

  it("rejects more than the import cap with 413 (SEC-001)", async () => {
    const trips = Array.from({ length: 2001 }, (_, i) => ({
      sourceCanyonName: "x",
      date: "2024-01-01",
      displayName: `${TAG}-overflow-${i}`,
    }));
    const res = await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({ importBatchId: `${TAG}-overflow`, trips });
    expect(res.status).toBe(413);
  });

  it("imports new rows, then re-importing the same rows updates rather than duplicates (idempotent)", async () => {
    const name = `${TAG}-idem`;
    const trips = [
      { sourceCanyonName: name, date: "2024-05-01", notes: "first", displayName: name },
      { sourceCanyonName: name, date: "2024-05-02", notes: "second", displayName: name },
    ];
    try {
      const first = await request(API_URL)
        .post("/trips/bulk")
        .set(AUTH)
        .send({ importBatchId: `${name}-batch`, trips });
      expect(first.status).toBe(200);
      expect(first.body.imported).toBe(2);
      expect(first.body.updated).toBe(0);
      expect(first.body.errors).toEqual([]);

      // Same importKey inputs (sourceCanyonName + date + notes + customFields)
      // → the second call must update in place, not create duplicates.
      const second = await request(API_URL)
        .post("/trips/bulk")
        .set(AUTH)
        .send({ importBatchId: `${name}-batch`, trips });
      expect(second.status).toBe(200);
      expect(second.body.imported).toBe(0);
      expect(second.body.updated).toBe(2);

      // Exactly two rows exist for this tag, confirming no duplication.
      const list = await request(API_URL).get("/trips").query({ search: name }).set(AUTH);
      expect(list.body.length).toBe(2);
    } finally {
      await deleteTripsBySearch(name);
    }
  });

  it("reports a per-row error for a canyon the importer does not own (no throw)", async () => {
    // carol owns this canyon; alice imports a row pointing at it.
    const carolCanyon = await request(API_URL)
      .post("/canyons")
      .set(as(CAROL_SUB))
      .send({ name: `${TAG}-carol`, latitude: -33.7, longitude: 150.3 });
    expect(carolCanyon.status).toBe(201);
    const carolCanyonId = carolCanyon.body.id as string;
    const name = `${TAG}-foreign`;
    try {
      const res = await request(API_URL)
        .post("/trips/bulk")
        .set(AUTH)
        .send({
          importBatchId: `${name}-batch`,
          trips: [
            { sourceCanyonName: name, canyonId: carolCanyonId, date: "2024-06-01", displayName: name },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(0);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0].error).toBe("not the canyon owner");
    } finally {
      await deleteTripsBySearch(name);
      await request(API_URL).delete(`/canyons/${carolCanyonId}`).set(as(CAROL_SUB));
    }
  });

  it("a row with types creates a trip with those types; re-importing the same importKey with different types updates it (types is not part of the hash)", async () => {
    const name = `${TAG}-type`;
    const trips = [
      { sourceCanyonName: name, date: "2024-07-01", displayName: name, types: ["canyoning"] },
    ];
    try {
      const first = await request(API_URL)
        .post("/trips/bulk")
        .set(AUTH)
        .send({ importBatchId: `${name}-batch`, trips });
      expect(first.status).toBe(200);
      expect(first.body.imported).toBe(1);

      const list1 = await request(API_URL).get("/trips").query({ search: name }).set(AUTH);
      expect(list1.body.length).toBe(1);
      expect(list1.body[0].types).toEqual(["canyoning"]);

      // Same sourceCanyonName/date/notes/customFields → same importKey — the
      // contract requires `types` NOT be part of the hash, so this changes
      // only the types field via an update, never a duplicate row.
      const second = await request(API_URL)
        .post("/trips/bulk")
        .set(AUTH)
        .send({
          importBatchId: `${name}-batch2`,
          trips: [{ ...trips[0], types: ["bushwalking", "packrafting"] }],
        });
      expect(second.status).toBe(200);
      expect(second.body.imported).toBe(0);
      expect(second.body.updated).toBe(1);

      const list2 = await request(API_URL).get("/trips").query({ search: name }).set(AUTH);
      expect(list2.body.length).toBe(1);
      expect(list2.body[0].types).toEqual(["bushwalking", "packrafting"]);
    } finally {
      await deleteTripsBySearch(name);
    }
  });

  it("a row-level types validation error (>40 chars) does not abort the batch", async () => {
    const name = `${TAG}-type-invalid`;
    const goodName = `${TAG}-type-invalid-good`;
    try {
      const res = await request(API_URL)
        .post("/trips/bulk")
        .set(AUTH)
        .send({
          importBatchId: `${name}-batch`,
          trips: [
            { sourceCanyonName: name, date: "2024-07-05", displayName: name, types: ["x".repeat(41)] },
            { sourceCanyonName: goodName, date: "2024-07-06", displayName: goodName },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(1);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0].error).toMatch(/types entries must be at most 40 characters/);
    } finally {
      await deleteTripsBySearch(name);
      await deleteTripsBySearch(goodName);
    }
  });

  it("a row with canyonId links a join row visible in canyons[]", async () => {
    const canyonName = `${TAG}-linked-canyon`;
    const canyonRes = await request(API_URL)
      .post("/canyons")
      .set(AUTH)
      .send({ name: canyonName, latitude: -33.7, longitude: 150.3 });
    expect(canyonRes.status).toBe(201);
    const canyonId = canyonRes.body.id as string;
    const name = `${TAG}-linked-trip`;
    try {
      const res = await request(API_URL)
        .post("/trips/bulk")
        .set(AUTH)
        .send({
          importBatchId: `${name}-batch`,
          trips: [
            { canyonId, sourceCanyonName: canyonName, date: "2024-07-02", displayName: name },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(1);

      const list = await request(API_URL).get("/trips").query({ search: name }).set(AUTH);
      expect(list.body.length).toBe(1);
      expect(list.body[0].canyons).toEqual([{ id: canyonId, name: canyonName }]);
    } finally {
      await deleteTripsBySearch(name);
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });

  // APIR-003: POST /trips and PATCH /trips/:id force the `canyoning` tag onto
  // any canyon-linked trip ("maintained on every write"); the bulk importer
  // linked canyons without it, so a CSV row with no types imported untagged and
  // stayed that way until someone re-saved it through PATCH.
  it("force-tags a canyon-linked imported row as canyoning", async () => {
    const canyonName = `${TAG}-tag-canyon`;
    const canyonRes = await request(API_URL)
      .post("/canyons")
      .set(AUTH)
      .send({ name: canyonName, latitude: -33.71, longitude: 150.31 });
    expect(canyonRes.status).toBe(201);
    const canyonId = canyonRes.body.id as string;
    const name = `${TAG}-tag-trip`;
    try {
      const res = await request(API_URL)
        .post("/trips/bulk")
        .set(AUTH)
        .send({
          importBatchId: `${name}-batch`,
          trips: [
            // No `types` at all — the tag must be added by the server.
            { canyonId, sourceCanyonName: canyonName, date: "2024-07-03", displayName: name },
          ],
        });
      expect(res.status).toBe(200);

      const list = await request(API_URL).get("/trips").query({ search: name }).set(AUTH);
      expect(list.body[0].types).toContain("canyoning");
    } finally {
      await deleteTripsBySearch(name);
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });

  // APIR-004: displayName went in verbatim, so an over-long CSV field produced
  // a row PATCH /trips/:id (which caps at TRIP_NAME_MAX_LENGTH) could never
  // save again.
  it("rejects an over-long displayName per row instead of storing it", async () => {
    const name = `${TAG}-longname`;
    const res = await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({
        importBatchId: `${name}-batch`,
        trips: [
          { sourceCanyonName: name, date: "2024-07-04", displayName: "x".repeat(201) },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.errors?.[0]?.error).toMatch(/at most 200 characters/);
  });

  // APIR-002: the documented contract is 0 → 400, over cap → 413 (SEC-001);
  // the delete path answered 400 for both.
  it("rejects an oversized delete with 413, and an empty one with 400", async () => {
    const ids = Array.from({ length: 501 }, () => NONEXISTENT_ID);
    const tooMany = await request(API_URL)
      .post("/trips/bulk/delete")
      .set(AUTH)
      .send({ ids });
    expect(tooMany.status).toBe(413);

    const empty = await request(API_URL)
      .post("/trips/bulk/delete")
      .set(AUTH)
      .send({ ids: [] });
    expect(empty.status).toBe(400);
  });
});
