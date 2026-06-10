import { describe, it, expect } from "vitest";
import request from "supertest";

// Requires `make dev` to be running (Postgres + LocalStack + API on :8080) with
// AUTH_MODE=fake (requests authenticate as the seeded alice user).
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

// 1x1 transparent PNG — content is never validated server-side (only the S3
// object size is read via HeadObject), but a real PNG keeps the test honest.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

async function putToPresignedUrl(url: string, body: Buffer, contentType: string) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
  });
  if (!res.ok) {
    throw new Error(`presigned PUT failed ${res.status}: ${await res.text()}`);
  }
}

describe("media upload lifecycle (fake auth)", () => {
  it("presign → upload → confirm → appears on canyon → delete", async () => {
    const canyonsRes = await request(API_URL).get("/canyons").set(AUTH);
    expect(canyonsRes.status).toBe(200);
    const canyonId: string = canyonsRes.body[0].id;

    // Presign
    const presignRes = await request(API_URL)
      .post("/media/presign")
      .set(AUTH)
      .send({
        linkedType: "canyon",
        linkedId: canyonId,
        filename: "test-photo.png",
        mediaType: "image/png",
        sizeBytes: PNG_BYTES.length,
        thumbnailSizeBytes: PNG_BYTES.length,
      });
    expect(presignRes.status).toBe(201);
    const { mediaId, displayUploadUrl, thumbnailUploadUrl } = presignRes.body;
    expect(typeof mediaId).toBe("string");
    expect(typeof displayUploadUrl).toBe("string");
    expect(typeof thumbnailUploadUrl).toBe("string"); // images carry a thumbnail

    // Upload both copies straight to S3 (LocalStack)
    await putToPresignedUrl(displayUploadUrl, PNG_BYTES, "image/png");
    await putToPresignedUrl(thumbnailUploadUrl, PNG_BYTES, "image/jpeg");

    // Confirm
    const confirmRes = await request(API_URL)
      .post(`/media/${mediaId}/confirm`)
      .set(AUTH)
      .send({
        linkedType: "canyon",
        linkedId: canyonId,
        filename: "test-photo.png",
        mediaType: "image/png",
      });
    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body.id).toBe(mediaId);
    expect(confirmRes.body.mediaType).toBe("image/png");
    expect(confirmRes.body.fileSizeBytes).toBe(PNG_BYTES.length * 2);
    expect(confirmRes.body.displayUrl).toContain("http");
    expect(confirmRes.body.thumbnailUrl).toContain("http");

    // Appears on the canyon detail with a presigned URL
    const detailRes = await request(API_URL).get(`/canyons/${canyonId}`).set(AUTH);
    expect(detailRes.status).toBe(200);
    const found = detailRes.body.media.find(
      (m: { id: string }) => m.id === mediaId,
    );
    expect(found).toBeTruthy();
    expect(found.displayUrl).toContain("http");

    // Delete
    const deleteRes = await request(API_URL).delete(`/media/${mediaId}`).set(AUTH);
    expect(deleteRes.status).toBe(204);

    // Gone from the canyon detail
    const afterRes = await request(API_URL).get(`/canyons/${canyonId}`).set(AUTH);
    expect(
      afterRes.body.media.some((m: { id: string }) => m.id === mediaId),
    ).toBe(false);
  });

  it("rejects an unsupported media type", async () => {
    const canyonsRes = await request(API_URL).get("/canyons").set(AUTH);
    const canyonId: string = canyonsRes.body[0].id;
    const res = await request(API_URL)
      .post("/media/presign")
      .set(AUTH)
      .send({
        linkedType: "canyon",
        linkedId: canyonId,
        filename: "archive.zip",
        mediaType: "application/zip",
        sizeBytes: 1024,
      });
    expect(res.status).toBe(400);
  });

  it("rejects a presign without sizeBytes (SEC-003)", async () => {
    const canyonsRes = await request(API_URL).get("/canyons").set(AUTH);
    const canyonId: string = canyonsRes.body[0].id;
    const res = await request(API_URL)
      .post("/media/presign")
      .set(AUTH)
      .send({
        linkedType: "canyon",
        linkedId: canyonId,
        filename: "test-photo.png",
        mediaType: "image/png",
      });
    expect(res.status).toBe(400);
  });

  it("rejects a presign whose sizeBytes exceeds the category cap (SEC-003)", async () => {
    const canyonsRes = await request(API_URL).get("/canyons").set(AUTH);
    const canyonId: string = canyonsRes.body[0].id;
    const res = await request(API_URL)
      .post("/media/presign")
      .set(AUTH)
      .send({
        linkedType: "canyon",
        linkedId: canyonId,
        filename: "test-photo.png",
        mediaType: "image/png",
        sizeBytes: 31 * 1024 * 1024, // image cap is 30 MB
        thumbnailSizeBytes: PNG_BYTES.length,
      });
    expect(res.status).toBe(413);
  });

  it("S3 rejects an upload larger than the signed Content-Length (SEC-003)", async () => {
    const canyonsRes = await request(API_URL).get("/canyons").set(AUTH);
    const canyonId: string = canyonsRes.body[0].id;
    const presignRes = await request(API_URL)
      .post("/media/presign")
      .set(AUTH)
      .send({
        linkedType: "canyon",
        linkedId: canyonId,
        filename: "test-photo.png",
        mediaType: "image/png",
        sizeBytes: PNG_BYTES.length,
        thumbnailSizeBytes: PNG_BYTES.length,
      });
    expect(presignRes.status).toBe(201);

    // The durable contract is that Content-Length is part of the SigV4
    // signature: real S3 rejects a PUT whose body size disagrees with the
    // signed value. LocalStack does not enforce SigV4 header validation, so
    // the rejection itself is only asserted off-LocalStack.
    const uploadUrl = new URL(presignRes.body.displayUploadUrl);
    expect(uploadUrl.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-length",
    );

    const oversized = Buffer.concat([PNG_BYTES, PNG_BYTES]);
    const res = await fetch(presignRes.body.displayUploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: oversized,
    });
    const isLocalStack = uploadUrl.port === "4566";
    if (!isLocalStack) {
      expect(res.ok).toBe(false);
    }
  });

  it("rejects a GPX whose extension doesn't match the track MIME", async () => {
    const canyonsRes = await request(API_URL).get("/canyons").set(AUTH);
    const canyonId: string = canyonsRes.body[0].id;
    const res = await request(API_URL)
      .post("/media/presign")
      .set(AUTH)
      .send({
        linkedType: "canyon",
        linkedId: canyonId,
        filename: "track.png",
        mediaType: "application/gpx+xml",
        sizeBytes: 1024,
      });
    expect(res.status).toBe(400);
  });

  it("forbids attaching media to a canyon the user does not own", async () => {
    const sharedRes = await request(API_URL).get("/canyons/shared").set(AUTH);
    expect(sharedRes.status).toBe(200);
    if (sharedRes.body.length === 0) return; // no shared canyons in this seed
    const sharedCanyonId: string = sharedRes.body[0].id;
    const res = await request(API_URL)
      .post("/media/presign")
      .set(AUTH)
      .send({
        linkedType: "canyon",
        linkedId: sharedCanyonId,
        filename: "test-photo.png",
        mediaType: "image/png",
        sizeBytes: PNG_BYTES.length,
        thumbnailSizeBytes: PNG_BYTES.length,
      });
    expect(res.status).toBe(403);
  });
});
