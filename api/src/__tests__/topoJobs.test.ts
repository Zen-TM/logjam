import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";
import { API_URL, as, BOB_SUB, BOB_ID } from "./_actors";

// Requires `make dev` (Postgres + MiniStack + API on :8080, AUTH_MODE=fake).
// No auth header = alice. These tests deliberately exercise only launch-free
// surfaces (auth, list, validation, ownership, the uploading-state lifecycle) —
// they never drive POST /:id/start to a real launch, which would spawn a
// MiniStack worker container.
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
    const res = await request(API_URL)
      .get("/topo-jobs/completed-overlays")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.jobs)).toBe(true);
    expect(typeof res.body.expiresAt).toBe("string");
  });

  it("404s an unknown job id (get / delete / start)", async () => {
    const missing = randomUUID();
    const getRes = await request(API_URL)
      .get(`/topo-jobs/${missing}`)
      .set(AUTH);
    expect(getRes.status).toBe(404);
    const delRes = await request(API_URL)
      .delete(`/topo-jobs/${missing}`)
      .set(AUTH);
    expect(delRes.status).toBe(404);
    const startRes = await request(API_URL)
      .post(`/topo-jobs/${missing}/start`)
      .set(AUTH);
    expect(startRes.status).toBe(404);
  });

  it("create → presign → foreign-403 → start-before-upload-400 → delete lifecycle", async () => {
    // Create: returns a job row in `uploading` and a presigned S3 PUT URL.
    // No ECS launch happens here (that's /start).
    const createRes = await request(API_URL)
      .post("/topo-jobs")
      .set(AUTH)
      .send({ jobName: "topo-integration-test" });
    expect(createRes.status).toBe(201);
    const jobId: string = createRes.body.jobId;
    expect(typeof jobId).toBe("string");
    expect(createRes.body.uploadUrl).toContain("http");

    try {
      // Owner can read it.
      const ownRes = await request(API_URL)
        .get(`/topo-jobs/${jobId}`)
        .set(AUTH);
      expect(ownRes.status).toBe(200);
      expect(ownRes.body.status).toBe("uploading");
      // Created without settings, so it gets the ones Logjam Web sends by
      // default: the worker has no fallback, and pipeline.py fails a job
      // whose settings lack a layer.
      expect(ownRes.body.layerOptions).toEqual(RASTER_TEMPLATE_DEFAULTS);

      // A stranger gets 404, NOT 403 (the anti-oracle rule in root AGENTS.md):
      // a 403 confirms the job id is real to someone with no right to know
      // it, while a 404 is indistinguishable from a job that never existed.
      // Direct sharing routes this endpoint through lib/shareAccess, which
      // enforces the rule. A SHAREE attempting an owner-only action still gets
      // 403 — they can legitimately see the job, so its existence is not a
      // secret from them (see directShare.test.ts).
      const bobRes = await request(API_URL)
        .get(`/topo-jobs/${jobId}`)
        .set(as(BOB_SUB));
      expect(bobRes.status).toBe(404);

      // Starting before the ZIP is uploaded is rejected (S3 HeadObject miss),
      // still launch-free.
      const startRes = await request(API_URL)
        .post(`/topo-jobs/${jobId}/start`)
        .set(AUTH);
      expect(startRes.status).toBe(400);
    } finally {
      const delRes = await request(API_URL)
        .delete(`/topo-jobs/${jobId}`)
        .set(AUTH);
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
      const shareRes = await request(API_URL).post("/shares").set(AUTH).send({
        entityType: "topoJob",
        entityId: jobId,
        sharedWithUserId: BOB_ID,
      });
      expect(shareRes.status).toBe(201);

      const bobRes = await request(API_URL)
        .get(`/topo-jobs/${jobId}`)
        .set(as(BOB_SUB));
      expect(bobRes.status).toBe(200);
      // The list and detail endpoints strip userId/s3OutputKeys for a
      // sharee (the owner's internal id and raw S3 keys). A sharee must see
      // status fields only.
      expect(bobRes.body.userId).toBeUndefined();
      expect(bobRes.body.s3OutputKeys).toBeUndefined();
      expect(bobRes.body.status).toBe("uploading");
      // All three job surfaces answer through serializeTopoJobFor, so the
      // detail response carries the read-only role rather than requiring a
      // client to infer it from a prior list call.
      expect(bobRes.body.syncRole).toBe("shared");

      // The owner's own detail response: keys yes, internal id still never.
      const aliceRes = await request(API_URL)
        .get(`/topo-jobs/${jobId}`)
        .set(AUTH);
      expect(aliceRes.status).toBe(200);
      expect(aliceRes.body.userId).toBeUndefined();
      expect(aliceRes.body.syncRole).toBe("owner");
      expect(aliceRes.body).toHaveProperty("s3OutputKeys");

      // A sharee starting the job is refused with copy that names the action.
      const startRes = await request(API_URL)
        .post(`/topo-jobs/${jobId}/start`)
        .set(as(BOB_SUB));
      expect(startRes.status).toBe(403);
      expect(startRes.body.error).toBe(
        "Only the owner can start this LiDAR map.",
      );
    } finally {
      await request(API_URL).delete(`/topo-jobs/${jobId}`).set(AUTH);
    }
  });

  it("multipart: only the owner signs parts or completes, and a gap refuses to join", async () => {
    const createRes = await request(API_URL)
      .post("/topo-jobs")
      .set(AUTH)
      .send({ jobName: "topo-multipart-test" });
    expect(createRes.status).toBe(201);
    const { jobId, uploadId, partSize } = createRes.body;
    expect(typeof uploadId).toBe("string");
    expect(partSize).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    const body = "not a zip";
    const sizeBytes = body.length;

    try {
      // Privacy boundary: a stranger gets the 404 a missing job gets, and a
      // sharee, who may see the job, is refused the owner's upload.
      // Mutation: drop requireShareOwner from ownUploadingJob.
      for (const path of ["parts", "complete"]) {
        const bobRes = await request(API_URL)
          .post(`/topo-jobs/${jobId}/${path}`)
          .set(as(BOB_SUB))
          .send({ uploadId, sizeBytes, partNumbers: [1], partCount: 1 });
        expect(bobRes.status).toBe(404);
      }
      const shareRes = await request(API_URL).post("/shares").set(AUTH).send({
        entityType: "topoJob",
        entityId: jobId,
        sharedWithUserId: BOB_ID,
      });
      expect(shareRes.status).toBe(201);
      const shareeRes = await request(API_URL)
        .post(`/topo-jobs/${jobId}/parts`)
        .set(as(BOB_SUB))
        .send({ uploadId, sizeBytes, partNumbers: [1] });
      expect(shareeRes.status).toBe(403);

      // The owner signs part 1 and sends it straight to S3.
      const signRes = await request(API_URL)
        .post(`/topo-jobs/${jobId}/parts`)
        .set(AUTH)
        .send({ uploadId, sizeBytes, partNumbers: [1] });
      expect(signRes.status).toBe(200);
      const [{ partNumber, url }] = signRes.body.parts;
      expect(partNumber).toBe(1);
      // The URL signs the part's length, so S3 refuses any other size.
      // Mutation: drop ContentLength from signTopoParts' UploadPartCommand,
      // or a presigner that stops signing content-length.
      expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toContain(
        "content-length",
      );
      const put = await fetch(url, { method: "PUT", body });
      expect(put.status).toBe(200);

      // Two parts claimed, one stored: no join.
      const gapRes = await request(API_URL)
        .post(`/topo-jobs/${jobId}/complete`)
        .set(AUTH)
        .send({ uploadId, partCount: 2 });
      expect(gapRes.status).toBe(400);
      expect(gapRes.body.error).toBe(
        "Part of that ZIP didn't upload. Try again.",
      );

      const doneRes = await request(API_URL)
        .post(`/topo-jobs/${jobId}/complete`)
        .set(AUTH)
        .send({ uploadId, partCount: 1 });
      expect(doneRes.status).toBe(204);
      // Completing again (a retry after a lost response) still succeeds.
      const againRes = await request(API_URL)
        .post(`/topo-jobs/${jobId}/complete`)
        .set(AUTH)
        .send({ uploadId, partCount: 1 });
      expect(againRes.status).toBe(204);

      // The object now exists, so /start gets past "didn't finish uploading"
      // to reading the ZIP, which these bytes are not. Still launch-free.
      const startRes = await request(API_URL)
        .post(`/topo-jobs/${jobId}/start`)
        .set(AUTH);
      expect(startRes.status).toBe(400);
      expect(startRes.body.error).not.toBe(
        "That ZIP didn't finish uploading. Try again.",
      );
    } finally {
      await request(API_URL).delete(`/topo-jobs/${jobId}`).set(AUTH);
    }
  });

  it("multipart: a part out of place refuses to join, and deleting the job aborts its upload", async () => {
    const createRes = await request(API_URL)
      .post("/topo-jobs")
      .set(AUTH)
      .send({ jobName: "topo-multipart-gap-test" });
    expect(createRes.status).toBe(201);
    const { jobId, uploadId, partSize } = createRes.body;
    const body = "not a zip";

    let partUrl = "";
    try {
      // A file of one full part and a short one; only the short part 2 is sent.
      const signRes = await request(API_URL)
        .post(`/topo-jobs/${jobId}/parts`)
        .set(AUTH)
        .send({
          uploadId,
          sizeBytes: partSize + body.length,
          partNumbers: [2],
        });
      expect(signRes.status).toBe(200);
      partUrl = signRes.body.parts[0].url;
      const put = await fetch(partUrl, { method: "PUT", body });
      expect(put.status).toBe(200);

      // One part claimed and one stored, but it is part 2.
      // Mutation: drop the PartNumber check in joinTopoUpload.
      const gapRes = await request(API_URL)
        .post(`/topo-jobs/${jobId}/complete`)
        .set(AUTH)
        .send({ uploadId, partCount: 1 });
      expect(gapRes.status).toBe(400);
      expect(gapRes.body.error).toBe(
        "Part of that ZIP didn't upload. Try again.",
      );
    } finally {
      const delRes = await request(API_URL)
        .delete(`/topo-jobs/${jobId}`)
        .set(AUTH);
      expect(delRes.status).toBe(204);
    }

    // The part URL is still within its 15 minutes, but the upload it signs
    // for is gone. Mutation: drop the abort from deleteTopoJobObjects.
    const after = await fetch(partUrl, { method: "PUT", body });
    expect(after.status).toBe(404);
  });
});
