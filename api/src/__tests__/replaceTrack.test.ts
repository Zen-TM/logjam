import { randomUUID } from "node:crypto";
import { afterEach, describe, it, expect } from "vitest";
import request from "supertest";
import prisma from "../services/prisma";
import {
  API_URL,
  as,
  ALICE_SUB,
  BOB_SUB,
  BOB_ID,
  CAROL_SUB,
  CAROL_ID,
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
const REFUSAL = "replaces must name your own uploaded track on this place";

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

const imports: { id: string; sub: string }[] = [];
afterEach(async () => {
  for (const { id, sub } of imports.splice(0)) {
    await request(API_URL).delete(`/media/${id}`).set(as(sub));
  }
});

/** An import in Saved, linked to no place; removed after the test. */
async function createImport(sub = ALICE_SUB): Promise<string> {
  const presign = await request(API_URL)
    .post("/media/presign")
    .set(as(sub))
    .send({ ...IMPORT, sizeBytes: GPX.length });
  expect(presign.status).toBe(201);
  await put(presign.body.displayUploadUrl);
  const id = presign.body.mediaId as string;
  imports.push({ id, sub });
  const confirm = await request(API_URL)
    .post(`/media/${id}/confirm`)
    .set(as(sub))
    .send(IMPORT);
  expect(confirm.status).toBe(201);
  return id;
}

/** A place of `sub`'s, shared with bob unless bob is the owner. */
async function createPlace(sub = ALICE_SUB) {
  const res = await request(API_URL).post("/places").set(as(sub)).send({
    placeTypeId: CANYON_TYPE_ID,
    name: "Replace Test Place",
    latitude: -33.7,
    longitude: 150.3,
  });
  expect(res.status).toBe(201);
  const placeId = res.body.id as string;
  if (sub !== BOB_SUB) {
    const share = await request(API_URL)
      .post(`/places/${placeId}/share`)
      .set(as(sub))
      .send({ sharedWithUserId: BOB_ID });
    expect(share.status).toBe(201);
  }
  return placeId;
}
const createSharedPlace = () => createPlace(ALICE_SUB);

const dropPlace = (placeId: string, sub = ALICE_SUB) =>
  request(API_URL).delete(`/places/${placeId}`).set(as(sub));

async function placeTrackIds(placeId: string, sub = ALICE_SUB) {
  const res = await request(API_URL).get("/places/tracks").set(as(sub));
  expect(res.status).toBe(200);
  return (res.body as { mediaId: string; placeId: string }[])
    .filter((t) => t.placeId === placeId)
    .map((t) => t.mediaId);
}

const usedBytes = async (sub: string) =>
  (await request(API_URL).get("/users/me").set(as(sub))).body
    .storageUsedBytes as number;

const pull = (sub: string, cursor: string) =>
  request(API_URL)
    .get("/sync/delta")
    .set({ ...as(sub), ...CLIENT })
    .query({ cursor, limit: 500 });

/** Run `task` with the user's quota set to exactly what they use now. */
async function atQuota<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.user.update({
    where: { id: userId },
    data: { storageQuotaBytes: user.storageUsedBytes },
  });
  try {
    return await task();
  } finally {
    await prisma.user.update({
      where: { id: userId },
      data: { storageQuotaBytes: user.storageQuotaBytes },
    });
  }
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
      const usedBefore = await usedBytes(ALICE_SUB);

      const second = await upload(placeId, ALICE_SUB, { replaces: oldId });
      expect(second.presign.status).toBe(201);
      expect(second.confirm!.status).toBe(201);
      const newId = second.confirm!.body.id as string;

      expect(await placeTrackIds(placeId)).toEqual([newId]);
      expect(await usedBytes(ALICE_SUB)).toBe(usedBefore);
      // The old row is gone, not just unlinked.
      const gone = await request(API_URL)
        .delete(`/media/${oldId}`)
        .set(as(ALICE_SUB));
      expect(gone.status).toBe(404);
    } finally {
      await dropPlace(placeId);
    }
  });

  it("swaps for a file of the same size at the quota, which has no room for both", async () => {
    // Mutation: leave the replaced file's size out of the presign's headroom
    // check (`freedBytes`), and a user at their quota is refused 507 at presign
    // for a swap that nets to zero.
    const placeId = await createPlace(CAROL_SUB);
    try {
      const first = await upload(placeId, CAROL_SUB);
      expect(first.confirm!.status).toBe(201);
      const oldId = first.presign.body.mediaId as string;
      await atQuota(CAROL_ID, async () => {
        const second = await upload(placeId, CAROL_SUB, { replaces: oldId });
        expect(second.presign.status).toBe(201);
        expect(second.confirm!.status).toBe(201);
        expect(await placeTrackIds(placeId, CAROL_SUB)).toEqual([
          second.confirm!.body.id,
        ]);
      });
    } finally {
      await dropPlace(placeId, CAROL_SUB);
    }
  });

  it("keeps the old track, the usage and the tombstones when the swap fails inside the transaction", async () => {
    // The quota changes between presign and confirm, so the 507 comes AFTER the
    // old row was deleted in the transaction. Mutation: run dropReplaced on the
    // global client instead of `tx` (or outside the transaction), and the old
    // track is gone and its usage freed although the new one was refused.
    const placeId = await createPlace(CAROL_SUB);
    try {
      const first = await upload(placeId, CAROL_SUB);
      const oldId = first.presign.body.mediaId as string;
      const cursor = (await pull(CAROL_SUB, "")).body.cursor as string;
      const presign = await request(API_URL)
        .post("/media/presign")
        .set(as(CAROL_SUB))
        .send({
          ...link(placeId),
          replaces: oldId,
          sizeBytes: GPX.length,
        });
      expect(presign.status).toBe(201);
      await put(presign.body.displayUploadUrl);
      const usedBefore = await usedBytes(CAROL_SUB);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: CAROL_ID },
      });
      await prisma.user.update({
        where: { id: CAROL_ID },
        data: { storageQuotaBytes: user.storageUsedBytes - 1n },
      });
      try {
        const confirm = await request(API_URL)
          .post(`/media/${presign.body.mediaId as string}/confirm`)
          .set(as(CAROL_SUB))
          .send({ ...link(placeId), replaces: oldId });
        expect(confirm.status).toBe(507);
      } finally {
        await prisma.user.update({
          where: { id: CAROL_ID },
          data: { storageQuotaBytes: user.storageQuotaBytes },
        });
      }

      expect(await placeTrackIds(placeId, CAROL_SUB)).toEqual([oldId]);
      expect(await usedBytes(CAROL_SUB)).toBe(usedBefore);
      const after = await pull(CAROL_SUB, cursor);
      expect(
        (after.body.tombstones as { id: string }[]).map((t) => t.id),
      ).not.toContain(oldId);
    } finally {
      await dropPlace(placeId, CAROL_SUB);
    }
  });

  it("still refuses a second track without replaces", async () => {
    // Mutation: make assertPlaceTrackSlotFree ignore every row, and the second
    // presign answers 201 and a place ends up with two tracks.
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
    // the old row in presign instead of at confirm.
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

  it("keeps the uploaded blob for a retry when the display name is refused", async () => {
    // Mutation: parse displayName inside the transaction and clean up after
    // every 400 there, and the refusal deletes a blob the client is about to
    // confirm once more.
    const placeId = await createSharedPlace();
    try {
      const presign = await request(API_URL)
        .post("/media/presign")
        .set(as(ALICE_SUB))
        .send({ ...link(placeId), sizeBytes: GPX.length });
      await put(presign.body.displayUploadUrl);
      const id = presign.body.mediaId as string;
      const refused = await request(API_URL)
        .post(`/media/${id}/confirm`)
        .set(as(ALICE_SUB))
        .send({ ...link(placeId), displayName: "x".repeat(500) });
      expect(refused.status).toBe(400);
      const retry = await request(API_URL)
        .post(`/media/${id}/confirm`)
        .set(as(ALICE_SUB))
        .send(link(placeId));
      expect(retry.status).toBe(201);
    } finally {
      await dropPlace(placeId);
    }
  });

  it("answers the same 400 on presign, confirm and link for a foreign, a missing, a wrong-place and a malformed id", async () => {
    // Mutation: answer 404 or 403 for a foreign id in assertOwnsReplaced, or

    const placeId = await createSharedPlace();
    const otherPlace = await createSharedPlace();
    const freePlace = await createSharedPlace();
    const bobPlace = await createPlace(BOB_SUB);
    try {
      const mine = await upload(placeId, ALICE_SUB);
      const oldId = mine.presign.body.mediaId as string;
      const elsewhere = await upload(otherPlace, ALICE_SUB);
      const elsewhereId = elsewhere.presign.body.mediaId as string;
      const bobTrack = await upload(bobPlace, BOB_SUB);
      const bobTrackId = bobTrack.presign.body.mediaId as string;
      const importId = await createImport();

      const bad: unknown[] = [bobTrackId, NONEXISTENT_ID, elsewhereId, 12345];
      const answers: { status: number; error: unknown }[] = [];
      for (const replaces of bad) {
        // Onto the occupied place, so presign gets past nothing but `replaces`.
        const presign = await request(API_URL)
          .post("/media/presign")
          .set(as(ALICE_SUB))
          .send({ ...link(placeId), replaces, sizeBytes: GPX.length });
        // Confirm and link onto an empty place, with the blob in storage, so
        // the only thing that can refuse them is `replaces`.
        const staged = await request(API_URL)
          .post("/media/presign")
          .set(as(ALICE_SUB))
          .send({ ...link(freePlace), sizeBytes: GPX.length });
        await put(staged.body.displayUploadUrl);
        const confirm = await request(API_URL)
          .post(`/media/${staged.body.mediaId as string}/confirm`)
          .set(as(ALICE_SUB))
          .send({ ...link(freePlace), replaces });
        const linked = await request(API_URL)
          .patch(`/media/${importId}/link`)
          .set(as(ALICE_SUB))
          .send({ linkedType: "place", linkedId: freePlace, replaces });
        for (const res of [presign, confirm, linked])
          answers.push({ status: res.status, error: res.body.detail });
      }
      expect(new Set(answers.map((a) => a.status))).toEqual(new Set([400]));
      // One message for all of them: no oracle for other people's ids.
      expect(new Set(answers.map((a) => a.error))).toEqual(new Set([REFUSAL]));
      // Nobody's file was touched, and nothing landed on the free place.
      expect(await placeTrackIds(placeId)).toEqual([oldId]);
      expect(await placeTrackIds(otherPlace)).toEqual([elsewhereId]);
      expect(await placeTrackIds(bobPlace, BOB_SUB)).toEqual([bobTrackId]);
      expect(await placeTrackIds(freePlace)).toEqual([]);
    } finally {
      await dropPlace(bobPlace, BOB_SUB);
      for (const id of [placeId, otherPlace, freePlace]) await dropPlace(id);
    }
  });

  it("does not let a sharee replace the owner's track, on presign, confirm or link", async () => {
    // Mutation: look at `replaces` before assertOwnsTarget (or let a sharee
    // pass it), and bob deletes alice's upload from a place shared with him.
    const placeId = await createSharedPlace();
    try {
      const mine = await upload(placeId, ALICE_SUB);
      const oldId = mine.presign.body.mediaId as string;
      const bobImport = await createImport(BOB_SUB);

      const presign = await request(API_URL)
        .post("/media/presign")
        .set(as(BOB_SUB))
        .send({ ...link(placeId), replaces: oldId, sizeBytes: GPX.length });
      const confirm = await request(API_URL)
        .post(`/media/${randomUUID()}/confirm`)
        .set(as(BOB_SUB))
        .send({ ...link(placeId), replaces: oldId });
      const linked = await request(API_URL)
        .patch(`/media/${bobImport}/link`)
        .set(as(BOB_SUB))
        .send({ linkedType: "place", linkedId: placeId, replaces: oldId });
      expect([presign.status, confirm.status, linked.status]).toEqual([
        403, 403, 403,
      ]);
      expect(await placeTrackIds(placeId)).toEqual([oldId]);
    } finally {
      await dropPlace(placeId);
    }
  });

  it("refuses to replace an import linked to the place (it is unlinked, never deleted)", async () => {
    // Mutation: drop the `origin !== null` test in assertOwnsReplaced, and a
    // swap can delete an import that lives on in Saved.
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

  it("tells a sharee to forget the old file and gives them the new one, and a stranger nothing", async () => {
    // Mutation: skip the tombstones in dropReplaced (the sharee keeps a ghost).
    const placeId = await createSharedPlace();
    try {
      const first = await upload(placeId, ALICE_SUB);
      const oldId = first.presign.body.mediaId as string;
      const before = await pull(BOB_SUB, "");
      expect(
        (before.body.changes.media as { id: string }[]).map((m) => m.id),
      ).toContain(oldId);
      const carolBefore = await pull(CAROL_SUB, "");

      const second = await upload(placeId, ALICE_SUB, { replaces: oldId });
      const newId = second.confirm!.body.id as string;

      const after = await pull(BOB_SUB, before.body.cursor as string);
      expect(after.status).toBe(200);
      expect(
        (after.body.tombstones as { type: string; id: string }[]).some(
          (t) => t.type === "media" && t.id === oldId,
        ),
      ).toBe(true);
      expect(
        (after.body.changes.media as { id: string }[]).map((m) => m.id),
      ).toContain(newId);

      // Carol was never shared the place: her delta has neither the new item
      // nor a tombstone that would tell her the old one existed.
      const carolAfter = await pull(CAROL_SUB, carolBefore.body.cursor);
      expect(
        (carolAfter.body.changes.media as { id: string }[]).map((m) => m.id),
      ).not.toContain(newId);
      expect(
        (carolAfter.body.tombstones as { id: string }[]).map((t) => t.id),
      ).not.toContain(oldId);
    } finally {
      await dropPlace(placeId);
    }
  });

  it("moves an import over an uploaded track in one step (PATCH /link with replaces), and answers a retry", async () => {
    // Mutation: drop `replaces` from the link's slot-check ignore list (409
    // after the refusal below); skip the `alreadyThere` test and the retry
    // answers 400 for the old file the swap deleted.
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

      const body = { linkedType: "place", linkedId: placeId, replaces: oldId };
      const swapped = await request(API_URL)
        .patch(`/media/${importId}/link`)
        .set(as(ALICE_SUB))
        .send(body);
      expect(swapped.status).toBe(200);
      expect(await placeTrackIds(placeId)).toEqual([importId]);
      // The import is still in Saved; the upload is gone.
      const files = await request(API_URL)
        .get("/media/standalone")
        .set(as(ALICE_SUB));
      expect(
        (files.body as { id: string }[]).some((f) => f.id === importId),
      ).toBe(true);

      const retry = await request(API_URL)
        .patch(`/media/${importId}/link`)
        .set(as(ALICE_SUB))
        .send(body);
      expect(retry.status).toBe(200);
      expect(await placeTrackIds(placeId)).toEqual([importId]);
    } finally {
      await dropPlace(placeId);
    }
  });
});
