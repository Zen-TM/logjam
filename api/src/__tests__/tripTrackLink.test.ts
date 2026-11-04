// "Log a trip" copies a recorded track into the trip as an ordinary file. The
// copy names its source recording (`sourceMediaId`) so the recording stops
// offering "Log a trip".
//
// The boundaries: a copy may only name the caller's own recording, and the
// link is the owner's alone. A mocked-Prisma unit test cannot see either.
//
// Requires `make dev` (Postgres + MiniStack + API on :8080) with AUTH_MODE=fake.
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import request from "supertest";

import { API_URL, as, ALICE_SUB, BOB_SUB, SHARED_PLACE_ID } from "./_actors";

const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;
const GPX_BYTES = Buffer.from(
  `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>
  <trkpt lat="-33.5" lon="150.4"/><trkpt lat="-33.51" lon="150.41"/>
</trkseg></trk></gpx>`,
  "utf8",
);
const GPX_MIME = "application/gpx+xml";
const TRACK_METADATA = {
  bbox: [150.4, -33.51, 150.41, -33.5],
  distanceM: 1500,
  durationMs: 3_600_000,
  elevationGainM: 20,
  elevationLossM: 20,
  pointCount: 2,
  startedAt: "2026-07-02T01:00:00.000Z",
  endedAt: "2026-07-02T02:00:00.000Z",
};

async function put(url: string) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": GPX_MIME },
    body: GPX_BYTES,
  });
  if (!res.ok) throw new Error(`presigned PUT failed ${res.status}`);
}

/** Presign (and, when `confirm`, upload and confirm) one GPX. */
async function uploadGpx(
  sub: string,
  body: Record<string, unknown>,
  mediaId = randomUUID(),
) {
  const presign = await request(API_URL)
    .post("/media/presign")
    .set(as(sub))
    .send({
      mediaId,
      filename: "t.gpx",
      mediaType: GPX_MIME,
      ...body,
      sizeBytes: GPX_BYTES.length,
    });
  if (presign.status !== 201) return { presign, confirm: null, mediaId };
  await put(presign.body.displayUploadUrl);
  const confirm = await request(API_URL)
    .post(`/media/${mediaId}/confirm`)
    .set(as(sub))
    .send({ filename: "t.gpx", mediaType: GPX_MIME, ...body });
  return { presign, confirm, mediaId };
}

const recording = (sub: string) =>
  uploadGpx(sub, {
    linkedType: "none",
    origin: "track",
    metadata: TRACK_METADATA,
  });

async function newTrip(sub: string): Promise<string> {
  const trip = await request(API_URL)
    .post("/trips")
    .set(as(sub))
    .send({ date: "2026-07-02" });
  expect(trip.status).toBe(201);
  return trip.body.id as string;
}

const cleanup = async (sub: string, ...ids: string[]) => {
  for (const id of ids)
    await request(API_URL).delete(`/media/${id}`).set(as(sub));
};

describe("a trip's copy of a recording names it", () => {
  it("round-trips through the item, the standalone list and the delta; deleting the trip clears hasTrip", async () => {
    const source = await recording(ALICE_SUB);
    const tripId = await newTrip(ALICE_SUB);
    try {
      const before = await request(API_URL)
        .get("/media/standalone")
        .set(as(ALICE_SUB));
      expect(
        before.body.find((f: { id: string }) => f.id === source.mediaId)
          .hasTrip,
      ).toBe(false);

      const copy = await uploadGpx(ALICE_SUB, {
        linkedType: "tripLog",
        linkedId: tripId,
        sourceMediaId: source.mediaId,
      });
      expect(copy.confirm?.status).toBe(201);
      expect(copy.confirm?.body.sourceMediaId).toBe(source.mediaId);
      expect(copy.confirm?.body.origin).toBeNull();

      const after = await request(API_URL)
        .get("/media/standalone")
        .set(as(ALICE_SUB));
      expect(
        after.body.find((f: { id: string }) => f.id === source.mediaId).hasTrip,
      ).toBe(true);

      // Drain the delta like a client: media may land on a later page.
      const rows: { id: string; sourceMediaId?: string | null }[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await request(API_URL)
          .get("/sync/delta")
          .query(cursor ? { cursor } : {})
          .set(as(ALICE_SUB))
          .set(CLIENT);
        expect(page.status).toBe(200);
        rows.push(...page.body.changes.media);
        cursor = page.body.cursor as string;
        if (!page.body.hasMore) break;
      }
      expect(rows.find((m) => m.id === copy.mediaId)?.sourceMediaId).toBe(
        source.mediaId,
      );

      await request(API_URL).delete(`/trips/${tripId}`).set(as(ALICE_SUB));
      const gone = await request(API_URL)
        .get("/media/standalone")
        .set(as(ALICE_SUB));
      expect(
        gone.body.find((f: { id: string }) => f.id === source.mediaId).hasTrip,
      ).toBe(false);
    } finally {
      await request(API_URL).delete(`/trips/${tripId}`).set(as(ALICE_SUB));
      await cleanup(ALICE_SUB, source.mediaId);
    }
  });

  // Mutation: drop assertOwnsSourceTrack's ownerId check and this returns 201.
  it("refuses another account's recording with the same 400 as a missing one", async () => {
    const bobs = await recording(BOB_SUB);
    const tripId = await newTrip(ALICE_SUB);
    try {
      const foreign = await uploadGpx(ALICE_SUB, {
        linkedType: "tripLog",
        linkedId: tripId,
        sourceMediaId: bobs.mediaId,
      });
      expect(foreign.presign.status).toBe(400);
      const missing = await uploadGpx(ALICE_SUB, {
        linkedType: "tripLog",
        linkedId: tripId,
        sourceMediaId: randomUUID(),
      });
      expect(missing.presign.status).toBe(400);
      expect(missing.presign.body.detail).toBe(foreign.presign.body.detail);
    } finally {
      await request(API_URL).delete(`/trips/${tripId}`).set(as(ALICE_SUB));
      await cleanup(BOB_SUB, bobs.mediaId);
    }
  });

  // Mutation: drop the origin check and an import is accepted as a source.
  it("refuses a source that is not a recording", async () => {
    const imported = await uploadGpx(ALICE_SUB, {
      linkedType: "none",
      origin: "import",
      metadata: {
        bbox: [150.4, -33.51, 150.41, -33.5],
        featureCount: 1,
        positionCount: 2,
      },
    });
    const tripId = await newTrip(ALICE_SUB);
    try {
      const res = await uploadGpx(ALICE_SUB, {
        linkedType: "tripLog",
        linkedId: tripId,
        sourceMediaId: imported.mediaId,
      });
      expect(res.presign.status).toBe(400);
    } finally {
      await request(API_URL).delete(`/trips/${tripId}`).set(as(ALICE_SUB));
      await cleanup(ALICE_SUB, imported.mediaId);
    }
  });

  // Mutation: accept sourceMediaId whatever the parent, and a place's file
  // (which reaches its sharees) could carry one.
  it("accepts a source on a trip's file only, and a malformed id nowhere", async () => {
    const source = await recording(ALICE_SUB);
    const tripId = await newTrip(ALICE_SUB);
    try {
      const onPlace = await uploadGpx(ALICE_SUB, {
        linkedType: "place",
        linkedId: SHARED_PLACE_ID,
        sourceMediaId: source.mediaId,
      });
      expect(onPlace.presign.status).toBe(400);
      const standalone = await uploadGpx(ALICE_SUB, {
        linkedType: "none",
        origin: "track",
        metadata: TRACK_METADATA,
        sourceMediaId: source.mediaId,
      });
      expect(standalone.presign.status).toBe(400);
      const malformed = await uploadGpx(ALICE_SUB, {
        linkedType: "tripLog",
        linkedId: tripId,
        sourceMediaId: "not-an-id",
      });
      expect(malformed.presign.status).toBe(400);
    } finally {
      await request(API_URL).delete(`/trips/${tripId}`).set(as(ALICE_SUB));
      await cleanup(ALICE_SUB, source.mediaId);
    }
  });
});
