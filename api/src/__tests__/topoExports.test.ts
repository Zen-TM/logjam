import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { API_URL } from "./_actors";

// Requires `make dev` (Postgres + MiniStack + API on :8080, AUTH_MODE=fake).
// No auth header = alice. Launch-free surfaces only (auth, list + truncation
// header, validation, not-found) — a valid POST would spawn a MiniStack export
// worker, so it is intentionally not exercised (CH-004).
const AUTH = { Authorization: "Bearer fake-token" } as const;

// Note: no unauthenticated-401 case — the integration suite runs only under
// AUTH_MODE=fake, where a request with no token defaults to the seeded alice
// (api/src/middleware/auth.ts). That path is unreachable here.
describe("topo-exports route (fake auth)", () => {
  it("lists exports and exposes the true total via X-Total-Count (UX-002)", async () => {
    const res = await request(API_URL).get("/topo-exports").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.exports)).toBe(true);
    const total = res.headers["x-total-count"];
    expect(total).toBeDefined();
    expect(Number.isNaN(Number(total))).toBe(false);
    // The header total is the pre-cap count, so it can never be below the page.
    expect(Number(total)).toBeGreaterThanOrEqual(res.body.exports.length);
  });

  it("rejects an invalid export request body", async () => {
    const res = await request(API_URL).post("/topo-exports").set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  it("404s an unknown export id (get / delete)", async () => {
    const missing = randomUUID();
    const getRes = await request(API_URL).get(`/topo-exports/${missing}`).set(AUTH);
    expect(getRes.status).toBe(404);
    const delRes = await request(API_URL).delete(`/topo-exports/${missing}`).set(AUTH);
    expect(delRes.status).toBe(404);
  });
});
