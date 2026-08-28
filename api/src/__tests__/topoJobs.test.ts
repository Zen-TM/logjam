import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { API_URL, as, BOB_SUB, BOB_ID } from "./_actors";

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

      // A stranger gets 404, NOT 403. This assertion used to expect 403 and
      // its comment called the oracle intended behaviour — it was the same
      // existence oracle the canyon routes closed (root CLAUDE.md): a 403
      // confirms the job id is real to someone with no right to know it, while
      // a 404 is indistinguishable from a job that never existed. Direct
      // sharing routed this endpoint through lib/shareAccess, which bakes the
      // rule in. A SHAREE attempting an owner-only action still gets 403 —
      // they can legitimately see the job, so its existence is not a secret
      // from them (see directShare.test.ts).
      const bobRes = await request(API_URL).get(`/topo-jobs/${jobId}`).set(as(BOB_SUB));
      expect(bobRes.status).toBe(404);

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

  it("a sharee polling the detail endpoint gets status fields, never the owner id or raw S3 keys", async () => {
    const createRes = await request(API_URL)
      .post("/topo-jobs")
      .set(AUTH)
      .send({ jobName: "sharee-detail-redaction" });
    expect(createRes.status).toBe(201);
    const jobId: string = createRes.body.jobId;

    try {
      const shareRes = await request(API_URL)
        .post("/shares")
        .set(AUTH)
        .send({ entityType: "topoJob", entityId: jobId, sharedWithUserId: BOB_ID });
      expect(shareRes.status).toBe(201);

      const bobRes = await request(API_URL)
        .get(`/topo-jobs/${jobId}`)
        .set(as(BOB_SUB));
      expect(bobRes.status).toBe(200);
      // Finding 9: the list endpoints strip userId/s3OutputKeys for a sharee;
      // the detail endpoint leaked both (the owner's internal id and raw S3
      // keys). A sharee must see status fields only.
      expect(bobRes.body.userId).toBeUndefined();
      expect(bobRes.body.s3OutputKeys).toBeUndefined();
      expect(bobRes.body.status).toBe("uploading");
    } finally {
      await request(API_URL).delete(`/topo-jobs/${jobId}`).set(AUTH);
    }
  });
});
