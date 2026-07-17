import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { API_URL, as, BOB_SUB } from "./_actors";

// Requires `make dev` (Postgres + MiniStack + API on :8080, AUTH_MODE=fake).
// No auth header = alice. These tests deliberately exercise only launch-free
// surfaces (auth, list, validation, ownership, the uploading-state lifecycle) —
// they never drive POST /:id/start to a real launch, which would spawn a
// MiniStack worker container (CH-004).
const AUTH = { Authorization: "Bearer fake-token" } as const;

// Note: no unauthenticated-401 case — the integration suite runs only under
// AUTH_MODE=fake, where a request with no token defaults to the seeded alice
// (api/src/middleware/auth.ts). That path is unreachable here.
describe("topo-jobs route (fake auth)", () => {
  it("lists the caller's jobs", async () => {
    const res = await request(API_URL).get("/topo-jobs").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns the completed-overlays envelope", async () => {
    const res = await request(API_URL).get("/topo-jobs/completed-overlays").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.jobs)).toBe(true);
    expect(typeof res.body.expiresAt).toBe("string");
  });

  it("404s an unknown job id (get / delete / start)", async () => {
    const missing = randomUUID();
    const getRes = await request(API_URL).get(`/topo-jobs/${missing}`).set(AUTH);
    expect(getRes.status).toBe(404);
    const delRes = await request(API_URL).delete(`/topo-jobs/${missing}`).set(AUTH);
    expect(delRes.status).toBe(404);
    const startRes = await request(API_URL).post(`/topo-jobs/${missing}/start`).set(AUTH);
    expect(startRes.status).toBe(404);
  });

  it("create → presign → foreign-403 → start-before-upload-400 → delete lifecycle", async () => {
    // Create: returns a job row in `uploading` and a presigned S3 PUT URL.
    // No ECS launch happens here (that's /start).
    const createRes = await request(API_URL)
      .post("/topo-jobs")
      .set(AUTH)
      .send({ jobName: "ch004-integration-test" });
    expect(createRes.status).toBe(201);
    const jobId: string = createRes.body.jobId;
    expect(typeof jobId).toBe("string");
    expect(createRes.body.uploadUrl).toContain("http");

    try {
      // Owner can read it.
      const ownRes = await request(API_URL).get(`/topo-jobs/${jobId}`).set(AUTH);
      expect(ownRes.status).toBe(200);
      expect(ownRes.body.status).toBe("uploading");

      // A different user cannot (job-id ownership oracle is 403, per route).
      const bobRes = await request(API_URL).get(`/topo-jobs/${jobId}`).set(as(BOB_SUB));
      expect(bobRes.status).toBe(403);

      // Starting before the ZIP is uploaded is rejected (S3 HeadObject miss),
      // still launch-free.
      const startRes = await request(API_URL).post(`/topo-jobs/${jobId}/start`).set(AUTH);
      expect(startRes.status).toBe(400);
    } finally {
      const delRes = await request(API_URL).delete(`/topo-jobs/${jobId}`).set(AUTH);
      expect(delRes.status).toBe(204);
    }

    // Gone after delete.
    const goneRes = await request(API_URL).get(`/topo-jobs/${jobId}`).set(AUTH);
    expect(goneRes.status).toBe(404);
  });
});
