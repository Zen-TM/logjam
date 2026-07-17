import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { API_URL } from "./_actors";

// Requires `make dev` (Postgres + MiniStack + API on :8080, AUTH_MODE=fake).
// No auth header = alice. Launch-free surfaces only (auth, list + truncation
// header, config validation, not-found). A valid config POST would create a
// job and launch a MiniStack GeoPDF worker, so only rejected configs (which
// 400 before the create/launch) are exercised (CH-004).
const AUTH = { Authorization: "Bearer fake-token" } as const;

// Note: no unauthenticated-401 case — the integration suite runs only under
// AUTH_MODE=fake, where a request with no token defaults to the seeded alice
// (api/src/middleware/auth.ts). That path is unreachable here.
describe("geo-pdf route (fake auth)", () => {
  it("lists jobs and exposes the true total via X-Total-Count (UX-002)", async () => {
    const res = await request(API_URL).get("/geo-pdf").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.jobs)).toBe(true);
    const total = res.headers["x-total-count"];
    expect(total).toBeDefined();
    expect(Number.isNaN(Number(total))).toBe(false);
    expect(Number(total)).toBeGreaterThanOrEqual(res.body.jobs.length);
  });

  it("rejects an empty/invalid config before any launch", async () => {
    const res = await request(API_URL).post("/geo-pdf").set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range extent before any launch (GEOPDF-1)", async () => {
    // north beyond +90 must be refused regardless of the rest of the config.
    const res = await request(API_URL)
      .post("/geo-pdf")
      .set(AUTH)
      .send({ extent: { north: 999, south: -34, east: 151, west: 150 } });
    expect(res.status).toBe(400);
  });

  it("404s an unknown job id (get / delete)", async () => {
    const missing = randomUUID();
    const getRes = await request(API_URL).get(`/geo-pdf/${missing}`).set(AUTH);
    expect(getRes.status).toBe(404);
    const delRes = await request(API_URL).delete(`/geo-pdf/${missing}`).set(AUTH);
    expect(delRes.status).toBe(404);
  });
});
