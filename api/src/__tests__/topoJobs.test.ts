import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";
import { API_URL, as, BOB_SUB, BOB_ID } from "./_actors";
import prisma from "../services/prisma";

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

  // A stored ZIP of one empty point-cloud file: all /start reads of it is the
  // central directory.
  function oneLazZip(name: string): Buffer {
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(nameBytes.length, 28);
    nameBytes.copy(central, 46);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(local.length, 16);
    return Buffer.concat([local, central, eocd]);
  }

  // The worker refuses a job with no mark (OLD_JOB), and only CI's topo-e2e
  // would otherwise notice /start forgetting it. This one does launch the
  // worker (on a ZIP it cannot read), so it runs where the stack has ECS.
  // Mutation: delete `sharpen: sharpenMark(...)` from /start.
  it("/start marks the job to sharpen", async () => {
    const createRes = await request(API_URL)
      .post("/topo-jobs")
      .set(AUTH)
      .send({ jobName: "topo-start-mark-test" });
    expect(createRes.status).toBe(201);
    const { jobId, uploadUrl } = createRes.body;
    try {
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/zip" },
        body: oneLazZip("Kanangra201804-LID2-C3-AHD_2400004_56_0001_0001.laz"),
      });
      expect(put.status).toBe(200);
      expect(
        (await prisma.topoJob.findUnique({ where: { id: jobId } }))?.sharpen,
      ).toBeNull();

      // 200 when the stack launches the worker, 500 when it cannot: the mark
      // is stored before either.
      const startRes = await request(API_URL)
        .post(`/topo-jobs/${jobId}/start`)
        .set(AUTH);
      expect([200, 500]).toContain(startRes.status);
      expect(
        (await prisma.topoJob.findUnique({ where: { id: jobId } }))?.sharpen,
      ).toEqual({ v: 1, vegetation: expect.any(Boolean) });
    } finally {
      await request(API_URL).delete(`/topo-jobs/${jobId}`).set(AUTH);
    }
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

  // An export of an area names the sharpened areas it reads in sourceJobIds,
  // and it may be another user's export, as a sharee's would be. Deleting
  // such an area's job is refused while the export runs, and fails the
  // export while it is queued, as for any export that reads the job's
  // outputs. Mutations: drop the running guard, or the queued force-fail.
  it("guards a job a running export of a box reads, and fails a queued one", async () => {
    const created = await request(API_URL)
      .post("/topo-jobs")
      .set(AUTH)
      .send({ jobName: "area an export reads" });
    expect(created.status).toBe(201);
    const jobId: string = created.body.jobId;
    const reading = await prisma.topoExportJob.create({
      data: {
        userId: BOB_ID,
        sourceJobIds: [jobId],
        layers: ["heights"],
        format: "geotiff",
        bundling: "per-layer",
        vectorStyleSnapshot: {},
        bbox: { west: 150.3, south: -33.71, east: 150.31, north: -33.7 },
        status: "running",
        startedAt: new Date(),
      },
    });
    try {
      const refused = await request(API_URL)
        .delete(`/topo-jobs/${jobId}`)
        .set(AUTH);
      expect(refused.status).toBe(409);

      await prisma.topoExportJob.update({
        where: { id: reading.id },
        data: { status: "queued", startedAt: null },
      });
      const deleted = await request(API_URL)
        .delete(`/topo-jobs/${jobId}`)
        .set(AUTH);
      expect(deleted.status).toBe(204);
      const after = await prisma.topoExportJob.findUniqueOrThrow({
        where: { id: reading.id },
      });
      expect(after.status).toBe("failed");
    } finally {
      await prisma.topoExportJob.deleteMany({ where: { id: reading.id } });
      await request(API_URL).delete(`/topo-jobs/${jobId}`).set(AUTH);
    }
  });
});
