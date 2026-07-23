import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { API_URL, ALICE_SUB, BOB_SUB, as } from "./_actors";

// Client-supplied create ids (Stage 8 §3.5 — outbox idempotency backbone).
// Uniform rules under test: strict UUIDv4 or 400; own-id replay → 200 with the
// existing row; foreign id → 404 (never 403/409 — no existence oracle for ids
// the caller can't see). Requires `make dev`.
// Synthetic coords only (committed-fixture rule).

// Same 1x1 PNG as media.test.ts — content is never validated server-side.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

describe("client-supplied ids — canyons", () => {
  it("create honours the id; replay returns 200 with the same row", async () => {
    const id = randomUUID();
    const created = await request(API_URL)
      .post("/canyons")
      .set(as(ALICE_SUB))
      .send({ id, name: "Client-id canyon", latitude: -33.61, longitude: 150.21 });
    expect(created.status).toBe(201);
    expect(created.body.id).toBe(id);

    // Replay (same id, possibly different payload — the original row wins).
    const replay = await request(API_URL)
      .post("/canyons")
      .set(as(ALICE_SUB))
      .send({ id, name: "Different name", latitude: -33.62, longitude: 150.22 });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(id);
    expect(replay.body.name).toBe("Client-id canyon");

    // Foreign id → 404, indistinguishable from nonexistent.
    const foreign = await request(API_URL)
      .post("/canyons")
      .set(as(BOB_SUB))
      .send({ id, name: "Hijack", latitude: -33.63, longitude: 150.23 });
    expect(foreign.status).toBe(404);

    await request(API_URL).delete(`/canyons/${id}`).set(as(ALICE_SUB));
  });

  it("rejects a non-UUIDv4 id with 400", async () => {
    const res = await request(API_URL)
      .post("/canyons")
      .set(as(ALICE_SUB))
      .send({ id: "not-a-uuid", name: "x", latitude: -33.61, longitude: 150.21 });
    expect(res.status).toBe(400);
  });
});

describe("client-supplied ids — trips", () => {
  it("create honours the id; replay 200; foreign 404", async () => {
    const id = randomUUID();
    const created = await request(API_URL)
      .post("/trips")
      .set(as(ALICE_SUB))
      .send({ id, date: "2026-07-02" });
    expect(created.status).toBe(201);
    expect(created.body.id).toBe(id);

    const replay = await request(API_URL)
      .post("/trips")
      .set(as(ALICE_SUB))
      .send({ id, date: "2026-07-03" });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(id);

    const foreign = await request(API_URL)
      .post("/trips")
      .set(as(BOB_SUB))
      .send({ id, date: "2026-07-04" });
    expect(foreign.status).toBe(404);

    await request(API_URL).delete(`/trips/${id}`).set(as(ALICE_SUB));
  });
});

describe("client-supplied ids — waypoints", () => {
  it("create honours the id; replay 200; foreign 404", async () => {
    const id = randomUUID();
    const created = await request(API_URL)
      .post("/waypoints")
      .set(as(ALICE_SUB))
      .send({ id, name: "Client-id wp", latitude: -33.64, longitude: 150.24 });
    expect(created.status).toBe(201);
    expect(created.body.id).toBe(id);

    const replay = await request(API_URL)
      .post("/waypoints")
      .set(as(ALICE_SUB))
      .send({ id, name: "Other", latitude: -33.65, longitude: 150.25 });
    expect(replay.status).toBe(200);
    expect(replay.body.name).toBe("Client-id wp");

    const foreign = await request(API_URL)
      .post("/waypoints")
      .set(as(BOB_SUB))
      .send({ id, name: "Hijack", latitude: -33.66, longitude: 150.26 });
    expect(foreign.status).toBe(404);

    await request(API_URL).delete(`/waypoints/${id}`).set(as(ALICE_SUB));
  });
});

describe("client-supplied ids — media presign/confirm", () => {
  it("presign honours mediaId; completed-flow re-presign returns the item; foreign probes 404", async () => {
    const mediaId = randomUUID();

    // Alice's own canyon to attach to.
    const canyon = await request(API_URL)
      .post("/canyons")
      .set(as(ALICE_SUB))
      .send({ name: "Media-id canyon", latitude: -33.67, longitude: 150.27 });
    expect(canyon.status).toBe(201);
    const canyonId = canyon.body.id as string;

    const presign = await request(API_URL)
      .post("/media/presign")
      .set(as(ALICE_SUB))
      .send({
        mediaId,
        linkedType: "canyon",
        linkedId: canyonId,
        filename: "client-id.png",
        mediaType: "image/png",
        sizeBytes: PNG_BYTES.length,
        thumbnailSizeBytes: PNG_BYTES.length,
      });
    expect(presign.status).toBe(201);
    expect(presign.body.mediaId).toBe(mediaId);

    // Upload + confirm (three-phase flow completes).
    for (const [url, type] of [
      [presign.body.displayUploadUrl, "image/png"],
      [presign.body.thumbnailUploadUrl, "image/jpeg"],
    ] as const) {
      const put = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": type },
        body: PNG_BYTES,
      });
      expect(put.ok).toBe(true);
    }
    const confirm = await request(API_URL)
      .post(`/media/${mediaId}/confirm`)
      .set(as(ALICE_SUB))
      .send({
        linkedType: "canyon",
        linkedId: canyonId,
        filename: "client-id.png",
        mediaType: "image/png",
      });
    expect(confirm.status).toBe(201);

    // Re-presign with the same id: the flow is already done — the existing
    // item comes back (200), never fresh upload URLs.
    const replay = await request(API_URL)
      .post("/media/presign")
      .set(as(ALICE_SUB))
      .send({
        mediaId,
        linkedType: "canyon",
        linkedId: canyonId,
        filename: "client-id.png",
        mediaType: "image/png",
        sizeBytes: PNG_BYTES.length,
        thumbnailSizeBytes: PNG_BYTES.length,
      });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(mediaId);
    expect(replay.body.displayUploadUrl).toBeUndefined();

    // Bob probes alice's mediaId on his own valid target: 404 from presign
    // AND from confirm — neither may confirm the id exists (anti-oracle).
    const bobCanyon = await request(API_URL)
      .post("/canyons")
      .set(as(BOB_SUB))
      .send({ name: "Bob target", latitude: -33.68, longitude: 150.28 });
    expect(bobCanyon.status).toBe(201);

    const foreignPresign = await request(API_URL)
      .post("/media/presign")
      .set(as(BOB_SUB))
      .send({
        mediaId,
        linkedType: "canyon",
        linkedId: bobCanyon.body.id,
        filename: "probe.png",
        mediaType: "image/png",
        sizeBytes: PNG_BYTES.length,
        thumbnailSizeBytes: PNG_BYTES.length,
      });
    expect(foreignPresign.status).toBe(404);

    const foreignConfirm = await request(API_URL)
      .post(`/media/${mediaId}/confirm`)
      .set(as(BOB_SUB))
      .send({
        linkedType: "canyon",
        linkedId: bobCanyon.body.id,
        filename: "probe.png",
        mediaType: "image/png",
      });
    expect(foreignConfirm.status).toBe(404);

    // teardown
    await request(API_URL).delete(`/media/${mediaId}`).set(as(ALICE_SUB));
    await request(API_URL).delete(`/canyons/${canyonId}`).set(as(ALICE_SUB));
    await request(API_URL)
      .delete(`/canyons/${bobCanyon.body.id as string}`)
      .set(as(BOB_SUB));
  });
});
