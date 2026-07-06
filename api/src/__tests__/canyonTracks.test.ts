import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL, as, ALICE_SUB, BOB_SUB, CAROL_SUB, SHARED_CANYON_ID } from "./_actors";

// Requires `make dev` (Postgres + MiniStack + API on :8080, AUTH_MODE=fake).
// Covers the track-specific media behaviour: colour assignment, the canyon
// 0/1-track guard, and the GET /canyons/tracks privacy boundary.

const GPX_BYTES = Buffer.from(
  '<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>' +
    '<trkpt lat="-33.70" lon="150.30"></trkpt><trkpt lat="-33.71" lon="150.31"></trkpt>' +
    "</trkseg></trk></gpx>",
);

async function putToPresignedUrl(url: string, body: Buffer, contentType: string) {
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body });
  if (!res.ok) throw new Error(`presigned PUT failed ${res.status}: ${await res.text()}`);
}

// Full presign → PUT → confirm for a canyon track as the given actor.
async function uploadTrack(
  canyonId: string,
  headers: Record<string, string>,
  filename = "route.gpx",
) {
  const presign = await request(API_URL)
    .post("/media/presign")
    .set(headers)
    .send({
      linkedType: "canyon",
      linkedId: canyonId,
      filename,
      mediaType: "application/gpx+xml",
      sizeBytes: GPX_BYTES.length,
    });
  if (presign.status !== 201) return { presign, confirm: null, mediaId: null as string | null };
  await putToPresignedUrl(presign.body.displayUploadUrl, GPX_BYTES, "application/gpx+xml");
  const confirm = await request(API_URL)
    .post(`/media/${presign.body.mediaId}/confirm`)
    .set(headers)
    .send({ linkedType: "canyon", linkedId: canyonId, filename, mediaType: "application/gpx+xml" });
  return { presign, confirm, mediaId: presign.body.mediaId as string };
}

async function createCanyon(headers: Record<string, string>) {
  const res = await request(API_URL)
    .post("/canyons")
    .set(headers)
    .send({ name: "Track Test Canyon", latitude: -33.7, longitude: 150.3 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("canyon tracks (fake auth)", () => {
  it("assigns a palette colour when a track is confirmed", async () => {
    const canyonId = await createCanyon(as(ALICE_SUB));
    try {
      const { confirm } = await uploadTrack(canyonId, as(ALICE_SUB));
      expect(confirm!.status).toBe(201);
      expect(confirm!.body.color).toMatch(/^#[0-9a-f]{6}$/);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(as(ALICE_SUB));
    }
  });

  it("allows at most one track per canyon (409 on the second)", async () => {
    const canyonId = await createCanyon(as(ALICE_SUB));
    try {
      const first = await uploadTrack(canyonId, as(ALICE_SUB));
      expect(first.confirm!.status).toBe(201);

      // Second presign is rejected fast, before any S3 PUT.
      const second = await request(API_URL)
        .post("/media/presign")
        .set(as(ALICE_SUB))
        .send({
          linkedType: "canyon",
          linkedId: canyonId,
          filename: "second.gpx",
          mediaType: "application/gpx+xml",
          sizeBytes: GPX_BYTES.length,
        });
      expect(second.status).toBe(409);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(as(ALICE_SUB));
    }
  });

  it("allows multiple tracks on a trip log", async () => {
    const canyonId = await createCanyon(as(ALICE_SUB));
    let tripId: string | undefined;
    try {
      // Trip creation moved to the global POST /trips — the nested POST was
      // removed with the trip↔canyon m2m cutover.
      const tripRes = await request(API_URL)
        .post("/trips")
        .set(as(ALICE_SUB))
        .send({ canyonIds: [canyonId], date: "2026-06-01" });
      expect(tripRes.status).toBe(201);
      tripId = tripRes.body.id as string;

      for (const filename of ["a.gpx", "b.gpx"]) {
        const presign = await request(API_URL)
          .post("/media/presign")
          .set(as(ALICE_SUB))
          .send({
            linkedType: "tripLog",
            linkedId: tripId,
            filename,
            mediaType: "application/gpx+xml",
            sizeBytes: GPX_BYTES.length,
          });
        expect(presign.status).toBe(201);
        await putToPresignedUrl(presign.body.displayUploadUrl, GPX_BYTES, "application/gpx+xml");
        const confirm = await request(API_URL)
          .post(`/media/${presign.body.mediaId}/confirm`)
          .set(as(ALICE_SUB))
          .send({ linkedType: "tripLog", linkedId: tripId, filename, mediaType: "application/gpx+xml" });
        expect(confirm.status).toBe(201);
      }
    } finally {
      if (tripId) await request(API_URL).delete(`/trips/${tripId}`).set(as(ALICE_SUB));
      await request(API_URL).delete(`/canyons/${canyonId}`).set(as(ALICE_SUB));
    }
  });

  it("GET /canyons/tracks: owner and sharee see a shared canyon's track, stranger does not", async () => {
    const upload = await uploadTrack(SHARED_CANYON_ID, as(ALICE_SUB));
    expect(upload.confirm!.status).toBe(201);
    const mediaId = upload.mediaId!;
    try {
      const ownerRes = await request(API_URL).get("/canyons/tracks").set(as(ALICE_SUB));
      expect(ownerRes.status).toBe(200);
      const ownerHit = ownerRes.body.find((t: { mediaId: string }) => t.mediaId === mediaId);
      expect(ownerHit).toBeTruthy();
      expect(ownerHit.canyonId).toBe(SHARED_CANYON_ID);
      expect(ownerHit.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(ownerHit.displayUrl).toContain("http");

      // Sharee (bob) sees canyon-level media → the track.
      const shareeRes = await request(API_URL).get("/canyons/tracks").set(as(BOB_SUB));
      expect(shareeRes.status).toBe(200);
      expect(shareeRes.body.some((t: { mediaId: string }) => t.mediaId === mediaId)).toBe(true);

      // Stranger (carol) sees nothing for it (no leak, no oracle).
      const strangerRes = await request(API_URL).get("/canyons/tracks").set(as(CAROL_SUB));
      expect(strangerRes.status).toBe(200);
      expect(strangerRes.body.some((t: { mediaId: string }) => t.mediaId === mediaId)).toBe(false);
    } finally {
      await request(API_URL).delete(`/media/${mediaId}`).set(as(ALICE_SUB));
    }
  });
});
