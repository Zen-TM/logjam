import { randomUUID } from "node:crypto";
import { afterEach, describe, it, expect } from "vitest";
import request from "supertest";
import {
  API_URL,
  as,
  ALICE_SUB,
  BOB_SUB,
  BOB_ID,
  CAROL_SUB,
  CANYON_TYPE_ID,
  NONEXISTENT_ID,
} from "./_actors";

// Requires `make dev` (Postgres + MiniStack + API on :8080, AUTH_MODE=fake).
// A track uploaded over the one already on a place (`replaces`): the new one
// lands and the old one goes in a single transaction at confirm.

const GPX = Buffer.from(
  '<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>' +
    '<trkpt lat="-33.70" lon="150.30"></trkpt><trkpt lat="-33.71" lon="150.31"></trkpt>' +
    "</trkseg></trk></gpx>",
);
const GPX_TYPE = "application/gpx+xml";
const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

async function put(url: string) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": GPX_TYPE },
    body: GPX,
  });
  if (!res.ok) throw new Error(`PUT failed ${res.status}`);
}

const link = (placeId: string) => ({
  linkedType: "place",
  linkedId: placeId,
  filename: "route.gpx",
  mediaType: GPX_TYPE,
});

/** presign → PUT → confirm; `skipPut` leaves the blob unwritten so the confirm fails. */
async function upload(
  placeId: string,
  sub: string,
  opts: { replaces?: unknown; mediaId?: string; skipPut?: boolean } = {},
) {
  const headers = as(sub);
  const body = {
    ...link(placeId),
    ...(opts.replaces !== undefined && { replaces: opts.replaces }),
  };
  const presign = await request(API_URL)
    .post("/media/presign")
    .set(headers)
    .send({
      ...body,
      ...(opts.mediaId && { mediaId: opts.mediaId }),
      sizeBytes: GPX.length,
    });
  if (presign.status !== 201) return { presign, confirm: null };
  if (!opts.skipPut) await put(presign.body.displayUploadUrl);
  const confirm = await request(API_URL)
    .post(`/media/${presign.body.mediaId}/confirm`)
    .set(headers)
    .send(body);
  return { presign, confirm };
}

const IMPORT = {
  linkedType: "none",
  origin: "import",
  filename: "route.gpx",
  mediaType: GPX_TYPE,
  metadata: {
    bbox: [150.3, -33.71, 150.31, -33.7],
    featureCount: 1,
    positionCount: 2,
  },
};

const imports: string[] = [];
afterEach(async () => {
  for (const id of imports.splice(0)) {
    await request(API_URL).delete(`/media/${id}`).set(as(ALICE_SUB));
  }
});

/** An import in Saved, linked to no place; removed after the test. */
async function createImport(): Promise<string> {
  const presign = await request(API_URL)
    .post("/media/presign")
    .set(as(ALICE_SUB))
    .send({ ...IMPORT, sizeBytes: GPX.length });
  expect(presign.status).toBe(201);
  await put(presign.body.displayUploadUrl);
  const id = presign.body.mediaId as string;
  imports.push(id);
  const confirm = await request(API_URL)
    .post(`/media/${id}/confirm`)
    .set(as(ALICE_SUB))
    .send(IMPORT);
  expect(confirm.status).toBe(201);
  return id;
}

async function createSharedPlace() {
  const res = await request(API_URL).post("/places").set(as(ALICE_SUB)).send({
    placeTypeId: CANYON_TYPE_ID,
    name: "Replace Test Place",
    latitude: -33.7,
    longitude: 150.3,
  });
  expect(res.status).toBe(201);
  const placeId = res.body.id as string;
  const share = await request(API_URL)
    .post(`/places/${placeId}/share`)
    .set(as(ALICE_SUB))
    .send({ sharedWithUserId: BOB_ID });
  expect(share.status).toBe(201);
  return placeId;
}

const dropPlace = (placeId: string) =>
  request(API_URL).delete(`/places/${placeId}`).set(as(ALICE_SUB));

async function placeTrackIds(placeId: string, sub = ALICE_SUB) {
  const res = await request(API_URL).get("/places/tracks").set(as(sub));
  expect(res.status).toBe(200);
  return (res.body as { mediaId: string; placeId: string }[])
    .filter((t) => t.placeId === placeId)
    .map((t) => t.mediaId);
}

describe("replacing a place's track (fake auth)", () => {
  it("swaps the new track in and deletes the old one, with the quota net", async () => {
    // Mutation: drop `replaces` from the slot check's ignore list and the
    // presign answers 409 instead of 201.
    const placeId = await createSharedPlace();
    try {
      const first = await upload(placeId, ALICE_SUB);
      expect(first.confirm!.status).toBe(201);
      const oldId = first.presign.body.mediaId as string;
      const used = async () =>
        (await request(API_URL).get("/users/me").set(as(ALICE_SUB))).body
          .storageUsedBytes as number;
      const usedBefore = await used();

      const second = await upload(placeId, ALICE_SUB, { replaces: oldId });
      expect(second.presign.status).toBe(201);
      expect(second.confirm!.status).toBe(201);
      const newId = second.confirm!.body.id as string;

      expect(await placeTrackIds(placeId)).toEqual([newId]);
      expect(await used()).toBe(usedBefore);
      // The old row is gone, not just unlinked.
      const gone = await request(API_URL)
        .delete(`/media/${oldId}`)
        .set(as(ALICE_SUB));
      expect(gone.status).toBe(404);
    } finally {
      await dropPlace(placeId);
    }
  });

  it("still refuses a second track without replaces", async () => {
    const placeId = await createSharedPlace();
    try {
      const first = await upload(placeId, ALICE_SUB);
      expect(first.confirm!.status).toBe(201);
      const second = await upload(placeId, ALICE_SUB);
      expect(second.presign.status).toBe(409);
    } finally {
      await dropPlace(placeId);
    }
  });

  it("leaves the old file on the place when the confirm fails", async () => {
    // The blob never reached storage, so the confirm refuses. Mutation: delete
    // the old row before the HEAD check in POST /media/:id/confirm.
    const placeId = await createSharedPlace();
    try {
      const first = await upload(placeId, ALICE_SUB);
      const oldId = first.presign.body.mediaId as string;

      const failed = await upload(placeId, ALICE_SUB, {
        replaces: oldId,
        skipPut: true,
      });
      expect(failed.presign.status).toBe(201);
      expect(failed.confirm!.status).toBe(400);
      expect(await placeTrackIds(placeId)).toEqual([oldId]);
    } finally {
      await dropPlace(placeId);
    }
  });

  it("answers the same 400 for a foreign, a missing, a wrong-place and a non-upload id", async () => {
    // Mutation: answer 404 or 403 for a foreign id in assertOwnsReplaced.
    const placeId = await createSharedPlace();
    const otherPlace = await createSharedPlace();
    try {
      const mine = await upload(placeId, ALICE_SUB);
      const oldId = mine.presign.body.mediaId as string;
      const elsewhere = await upload(otherPlace, ALICE_SUB);
      const elsewhereId = elsewhere.presign.body.mediaId as string;
      // Bob's own track on a place of his own: real, but not alice's.
      const bobPlace = await request(API_URL)
        .post("/places")
        .set(as(BOB_SUB))
        .send({
          placeTypeId: CANYON_TYPE_ID,
          name: "Bob Replace Place",
          latitude: -33.7,
          longitude: 150.3,
        });
      const bobTrack = await upload(bobPlace.body.id as string, BOB_SUB);
      const bobTrackId = bobTrack.presign.body.mediaId as string;

      try {
        const refusals = [];
        for (const replaces of [
          bobTrackId, // foreign
          NONEXISTENT_ID, // missing
          elsewhereId, // alice's, but on another place
          12345, // not an id
        ]) {
          const res = await request(API_URL)
            .post("/media/presign")
            .set(as(ALICE_SUB))
            .send({ ...link(placeId), replaces, sizeBytes: GPX.length });
          refusals.push({ status: res.status, body: res.body });
        }
        expect(new Set(refusals.map((r) => r.status))).toEqual(new Set([400]));
        // One message for all of them: no oracle for other people's ids.
        expect(new Set(refusals.map((r) => r.body.error)).size).toBe(1);
        // Alice's file, untouched by any of it.
        expect(await placeTrackIds(placeId)).toEqual([oldId]);
      } finally {
        await request(API_URL)
          .delete(`/places/${bobPlace.body.id as string}`)
          .set(as(BOB_SUB));
      }
    } finally {
      await dropPlace(placeId);
      await dropPlace(otherPlace);
    }
  });

  it("refuses to replace an import linked to the place (it is unlinked, never deleted)", async () => {
    const placeId = await createSharedPlace();
    try {
      const importId = await createImport();
      const linked = await request(API_URL)
        .patch(`/media/${importId}/link`)
        .set(as(ALICE_SUB))
        .send({ linkedType: "place", linkedId: placeId });
      expect(linked.status).toBe(200);

      const over = await upload(placeId, ALICE_SUB, { replaces: importId });
      expect(over.presign.status).toBe(400);
      expect(await placeTrackIds(placeId)).toEqual([importId]);
    } finally {
      await dropPlace(placeId);
    }
  });

  it("answers a replay of the confirm with the new track, not a 400 for the vanished old one", async () => {
    // The swap deleted the old file; the client re-sends its confirm because the
    // reply was lost. Mutation: validate `replaces` before the replay lookup in
    // POST /media/:id/confirm.
    const placeId = await createSharedPlace();
    try {
      const first = await upload(placeId, ALICE_SUB);
      const oldId = first.presign.body.mediaId as string;
      const newId = randomUUID();
      const second = await upload(placeId, ALICE_SUB, {
        replaces: oldId,
        mediaId: newId,
      });
      expect(second.confirm!.status).toBe(201);

      const body = { ...link(placeId), replaces: oldId };
      const confirmAgain = await request(API_URL)
        .post(`/media/${newId}/confirm`)
        .set(as(ALICE_SUB))
        .send(body);
      expect(confirmAgain.status).toBe(200);
      expect(confirmAgain.body.id).toBe(newId);
      const presignAgain = await request(API_URL)
        .post("/media/presign")
        .set(as(ALICE_SUB))
        .send({ ...body, mediaId: newId, sizeBytes: GPX.length });
      expect(presignAgain.status).toBe(200);
      expect(await placeTrackIds(placeId)).toEqual([newId]);
    } finally {
      await dropPlace(placeId);
    }
  });

  it("tells a sharee to forget the old file and gives them the new one", async () => {
    // Mutation: skip the tombstones in dropReplaced.
    const placeId = await createSharedPlace();
    try {
      const first = await upload(placeId, ALICE_SUB);
      const oldId = first.presign.body.mediaId as string;
      const pull = (cursor: string) =>
        request(API_URL)
          .get("/sync/delta")
          .set({ ...as(BOB_SUB), ...CLIENT })
          .query({ cursor, limit: 500 });
      const before = await pull("");
      expect(
        (before.body.changes.media as { id: string }[]).map((m) => m.id),
      ).toContain(oldId);

      const second = await upload(placeId, ALICE_SUB, { replaces: oldId });
      const newId = second.confirm!.body.id as string;

      const after = await pull(before.body.cursor as string);
      expect(after.status).toBe(200);
      expect(
        (after.body.tombstones as { type: string; id: string }[]).some(
          (t) => t.type === "media" && t.id === oldId,
        ),
      ).toBe(true);
      expect(
        (after.body.changes.media as { id: string }[]).map((m) => m.id),
      ).toContain(newId);
      // A stranger learns nothing of either.
      expect(await placeTrackIds(placeId, CAROL_SUB)).toEqual([]);
    } finally {
      await dropPlace(placeId);
    }
  });

  it("moves an import over an uploaded track in one step (PATCH /link with replaces)", async () => {
    const placeId = await createSharedPlace();
    try {
      const first = await upload(placeId, ALICE_SUB);
      const oldId = first.presign.body.mediaId as string;
      const importId = await createImport();

      const refused = await request(API_URL)
        .patch(`/media/${importId}/link`)
        .set(as(ALICE_SUB))
        .send({ linkedType: "place", linkedId: placeId });
      expect(refused.status).toBe(409);
      expect(await placeTrackIds(placeId)).toEqual([oldId]);

      const swapped = await request(API_URL)
        .patch(`/media/${importId}/link`)
        .set(as(ALICE_SUB))
        .send({ linkedType: "place", linkedId: placeId, replaces: oldId });
      expect(swapped.status).toBe(200);
      expect(await placeTrackIds(placeId)).toEqual([importId]);
      // The import is still in Saved; the upload is gone.
      const files = await request(API_URL)
        .get("/media/standalone")
        .set(as(ALICE_SUB));
      expect(
        (files.body as { id: string }[]).some((f) => f.id === importId),
      ).toBe(true);
    } finally {
      await dropPlace(placeId);
    }
  });
});
