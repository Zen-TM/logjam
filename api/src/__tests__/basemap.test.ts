import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL, as, BOB_SUB } from "./_actors";

// routes/basemap.ts: auth-free paths only. A successful region clip shells out
// to pmtiles against the Protomaps archive, which a dev stack may not have, so
// the POST cases accept 503 (archive not configured) as well as 400.
// No unauthenticated-401 case: fake auth treats a missing header as alice.
const AUTH = { Authorization: "Bearer fake-token" } as const;

describe("basemap region clips", () => {
  it("POST /basemap/region-clip rejects a body that is not a region", async () => {
    const res = await request(API_URL)
      .post("/basemap/region-clip")
      .set(AUTH)
      .send({ bbox: "nope" });
    expect([400, 503]).toContain(res.status);
    expect(res.body.error ?? res.body.message).toBeTruthy();
  });

  it("GET /basemap/region-clip/:token answers 404 for an unknown token", async () => {
    const res = await request(API_URL)
      .get("/basemap/region-clip/not-a-real-token")
      .set(AUTH);
    expect(res.status).toBe(404);
    const other = await request(API_URL)
      .get("/basemap/region-clip/not-a-real-token")
      .set(as(BOB_SUB));
    expect(other.status).toBe(404);
  });
});
