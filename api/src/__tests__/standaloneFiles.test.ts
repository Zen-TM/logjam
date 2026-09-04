// Standalone files: the account's own imports and recordings, which belong to
// no canyon — and what happens when one is LINKED as a canyon's way.
//
// This is the boundary test the root CLAUDE.md requires for any new endpoint on
// shared canyons. The interesting cases are all about the second party: a
// standalone file is owner-private, linking it to a shared canyon GRANTS a
// sharee sight of it, and unlinking has to take that sight away again while the
// owner keeps the file. A mocked-Prisma unit test cannot see any of that.
//
// Requires `make dev` (Postgres + MiniStack + API on :8080) with AUTH_MODE=fake.
import { describe, it, expect } from "vitest";
import request from "supertest";

import {
  API_URL,
  as,
  ALICE_SUB,
  BOB_SUB,
  CAROL_SUB,
  NONEXISTENT_ID,
  SHARED_CANYON_ID,
} from "./_actors";

// The delta endpoint requires the client-version header the min-version lever
// reads (requireClientHeader) — same constant the sync boundary suite uses.
const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

const GPX = `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>
  <trkpt lat="-33.5" lon="150.4"/><trkpt lat="-33.51" lon="150.41"/>
</trkseg></trk></gpx>`;
const GPX_BYTES = Buffer.from(GPX, "utf8");
const GPX_MIME = "application/gpx+xml";

const IMPORT_METADATA = {
  bbox: [150.4, -33.51, 150.41, -33.5],
  featureCount: 1,
  positionCount: 2,
};

async function putToPresignedUrl(url: string, body: Buffer, contentType: string) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
  });
  if (!res.ok) throw new Error(`presigned PUT failed ${res.status}`);
}

/** Upload one standalone import and return its media id. */
async function createStandaloneImport(
  sub: string,
  filename = `import-${Date.now()}-${Math.random().toString(16).slice(2)}.gpx`,
  displayName?: string,
): Promise<string> {
  const body = {
    linkedType: "none",
    origin: "import",
    filename,
    mediaType: GPX_MIME,
    metadata: IMPORT_METADATA,
    ...(displayName ? { displayName } : {}),
  };
  const presign = await request(API_URL)
    .post("/media/presign")
    .set(as(sub))
    .send({ ...body, sizeBytes: GPX_BYTES.length });
  expect(presign.status).toBe(201);
  // A track file carries no thumbnail, standalone or not.
  expect(presign.body.thumbnailUploadUrl).toBeNull();

  await putToPresignedUrl(presign.body.displayUploadUrl, GPX_BYTES, GPX_MIME);

  const confirm = await request(API_URL)
    .post(`/media/${presign.body.mediaId}/confirm`)
    .set(as(sub))
    .send(body);
  expect(confirm.status).toBe(201);
  expect(confirm.body.linkedType).toBe("none");
  expect(confirm.body.linkedId).toBeNull();
  expect(confirm.body.origin).toBe("import");
  // Stats survive the round trip — this is what lets another device list the
  // file without downloading it.
  expect(confirm.body.metadata).toEqual(IMPORT_METADATA);
  return presign.body.mediaId as string;
}

async function deleteMedia(sub: string, id: string) {
  await request(API_URL).delete(`/media/${id}`).set(as(sub));
}

describe("a standalone file belongs to its owner and to nobody else", () => {
  it("uploads with no parent, and lists for the owner alone", async () => {
    const mediaId = await createStandaloneImport(ALICE_SUB);
    try {
      const mine = await request(API_URL).get("/media/standalone").set(as(ALICE_SUB));
      expect(mine.status).toBe(200);
      expect(mine.body.some((file: { id: string }) => file.id === mediaId)).toBe(true);

      // A stranger's list is their own. Not an authorisation error — the row is
      // simply not theirs, and an error would confirm it exists.
      const theirs = await request(API_URL).get("/media/standalone").set(as(CAROL_SUB));
      expect(theirs.status).toBe(200);
      expect(theirs.body.some((file: { id: string }) => file.id === mediaId)).toBe(false);
    } finally {
      await deleteMedia(ALICE_SUB, mediaId);
    }
  });

  it("refuses a parentless row with no origin — it would be invisible everywhere", async () => {
    const res = await request(API_URL)
      .post("/media/presign")
      .set(as(ALICE_SUB))
      .send({
        linkedType: "none",
        filename: "orphan.gpx",
        mediaType: GPX_MIME,
        sizeBytes: GPX_BYTES.length,
      });
    expect(res.status).toBe(400);
  });

  it("refuses a standalone row that also claims a parent", async () => {
    const res = await request(API_URL)
      .post("/media/presign")
      .set(as(ALICE_SUB))
      .send({
        linkedType: "none",
        linkedId: NONEXISTENT_ID,
        origin: "import",
        filename: "confused.gpx",
        mediaType: GPX_MIME,
        sizeBytes: GPX_BYTES.length,
      });
    expect(res.status).toBe(400);
  });

  it("refuses stats that would render as a broken row rather than storing them", async () => {
    const res = await request(API_URL)
      .post("/media/presign")
      .set(as(ALICE_SUB))
      .send({
        linkedType: "none",
        origin: "import",
        filename: "bad-stats.gpx",
        mediaType: GPX_MIME,
        sizeBytes: GPX_BYTES.length,
        metadata: { bbox: [999, -33.5, 150.41, -33.4], featureCount: 1, positionCount: 2 },
      });
    expect(res.status).toBe(400);
  });
});

describe("linking a standalone file as a canyon's way", () => {
  it("grants the canyon's sharee sight of it, and unlinking takes it back", async () => {
    const canyonId = SHARED_CANYON_ID;
    const mediaId = await createStandaloneImport(ALICE_SUB);
    try {
      // Before linking: owner-private. Bob sees the canyon but not the file.
      const before = await request(API_URL).get(`/canyons/${canyonId}`).set(as(BOB_SUB));
      expect(before.status).toBe(200);
      expect(before.body.media.some((m: { id: string }) => m.id === mediaId)).toBe(false);

      const link = await request(API_URL)
        .patch(`/media/${mediaId}/link`)
        .set(as(ALICE_SUB))
        .send({ linkedType: "canyon", linkedId: canyonId });
      expect(link.status).toBe(200);
      expect(link.body.linkedId).toBe(canyonId);

      const after = await request(API_URL).get(`/canyons/${canyonId}`).set(as(BOB_SUB));
      expect(after.body.media.some((m: { id: string }) => m.id === mediaId)).toBe(true);

      const unlink = await request(API_URL)
        .patch(`/media/${mediaId}/link`)
        .set(as(ALICE_SUB))
        .send({ linkedType: "none" });
      expect(unlink.status).toBe(200);
      expect(unlink.body.linkedType).toBe("none");
      expect(unlink.body.linkedId).toBeNull();

      // Revoked for the sharee...
      const revoked = await request(API_URL).get(`/canyons/${canyonId}`).set(as(BOB_SUB));
      expect(revoked.body.media.some((m: { id: string }) => m.id === mediaId)).toBe(false);
      // ...and still the owner's. THIS is the change: displacing a canyon's way
      // used to delete the file, because the canyon held a copy of it.
      const mine = await request(API_URL).get("/media/standalone").set(as(ALICE_SUB));
      expect(mine.body.some((file: { id: string }) => file.id === mediaId)).toBe(true);
    } finally {
      await deleteMedia(ALICE_SUB, mediaId);
    }
  });

  it("refuses a foreign file with 404, never 403 — the status is not an oracle", async () => {
    const mediaId = await createStandaloneImport(ALICE_SUB);
    try {
      const canyonId = SHARED_CANYON_ID;
      const res = await request(API_URL)
        .patch(`/media/${mediaId}/link`)
        .set(as(BOB_SUB))
        .send({ linkedType: "canyon", linkedId: canyonId });
      expect(res.status).toBe(404);

      const rename = await request(API_URL)
        .patch(`/media/${mediaId}`)
        .set(as(BOB_SUB))
        .send({ displayName: "not yours" });
      expect(rename.status).toBe(404);
    } finally {
      await deleteMedia(ALICE_SUB, mediaId);
    }
  });

  it("refuses to link onto a canyon whose way is already taken", async () => {
    const canyonId = SHARED_CANYON_ID;
    const first = await createStandaloneImport(ALICE_SUB);
    const second = await createStandaloneImport(ALICE_SUB);
    try {
      const linkFirst = await request(API_URL)
        .patch(`/media/${first}/link`)
        .set(as(ALICE_SUB))
        .send({ linkedType: "canyon", linkedId: canyonId });
      expect(linkFirst.status).toBe(200);

      const linkSecond = await request(API_URL)
        .patch(`/media/${second}/link`)
        .set(as(ALICE_SUB))
        .send({ linkedType: "canyon", linkedId: canyonId });
      expect(linkSecond.status).toBe(409);

      // Re-linking the INCUMBENT to the same canyon is a no-op, not a
      // self-conflict: it is its own occupant.
      const relink = await request(API_URL)
        .patch(`/media/${first}/link`)
        .set(as(ALICE_SUB))
        .send({ linkedType: "canyon", linkedId: canyonId });
      expect(relink.status).toBe(200);
    } finally {
      await deleteMedia(ALICE_SUB, first);
      await deleteMedia(ALICE_SUB, second);
    }
  });

  it("only a standalone file can be linked — a photo has no existence apart from its canyon", async () => {
    const canyonId = SHARED_CANYON_ID;
    const canyon = await request(API_URL).get(`/canyons/${canyonId}`).set(as(ALICE_SUB));
    const photo = canyon.body.media.find(
      (m: { mediaType: string }) => m.mediaType.startsWith("image/"),
    );
    if (!photo) return; // seed has one; skip rather than fail if it is ever dropped
    const res = await request(API_URL)
      .patch(`/media/${photo.id}/link`)
      .set(as(ALICE_SUB))
      .send({ linkedType: "none" });
    expect(res.status).toBe(400);
  });
});

describe("renaming a standalone file", () => {
  it("changes the label without touching the filename the download uses", async () => {
    const mediaId = await createStandaloneImport(ALICE_SUB, "wollangambe-run.gpx");
    try {
      const res = await request(API_URL)
        .patch(`/media/${mediaId}`)
        .set(as(ALICE_SUB))
        .send({ displayName: "Wollangambe, 2 Aug" });
      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe("Wollangambe, 2 Aug");
      expect(res.body.filename).toBe("wollangambe-run.gpx");
    } finally {
      await deleteMedia(ALICE_SUB, mediaId);
    }
  });

  it("clears the label back to null rather than storing an empty string", async () => {
    const mediaId = await createStandaloneImport(ALICE_SUB, undefined, "Named");
    try {
      const res = await request(API_URL)
        .patch(`/media/${mediaId}`)
        .set(as(ALICE_SUB))
        .send({ displayName: "   " });
      expect(res.status).toBe(200);
      expect(res.body.displayName).toBeNull();
    } finally {
      await deleteMedia(ALICE_SUB, mediaId);
    }
  });
});

describe("the delta pull carries standalone files", () => {
  it("delivers the owner's own, and re-delivers one whose parent moved", async () => {
    const canyonId = SHARED_CANYON_ID;
    const mediaId = await createStandaloneImport(ALICE_SUB);
    try {
      const first = await request(API_URL)
        .get("/sync/delta")
        .set(as(ALICE_SUB))
        .set(CLIENT);
      expect(first.status).toBe(200);
      const row = first.body.changes.media.find((m: { id: string }) => m.id === mediaId);
      expect(row).toBeDefined();
      expect(row.linkedType).toBe("none");
      expect(row.linkedId).toBeNull();
      expect(row.origin).toBe("import");
      expect(row.metadata).toEqual(IMPORT_METADATA);

      // A cursor from AFTER the upload, then a link: the row must come back.
      // It would not on a createdAt keyset, which is what this column change
      // was for — the other device would show a stale parent forever.
      const cursor = first.body.cursor;
      await request(API_URL)
        .patch(`/media/${mediaId}/link`)
        .set(as(ALICE_SUB))
        .send({ linkedType: "canyon", linkedId: canyonId });

      const second = await request(API_URL)
        .get("/sync/delta")
        .query({ cursor })
        .set(as(ALICE_SUB))
        .set(CLIENT);
      expect(second.status).toBe(200);
      const moved = second.body.changes.media.find((m: { id: string }) => m.id === mediaId);
      expect(moved).toBeDefined();
      expect(moved.linkedId).toBe(canyonId);
    } finally {
      await deleteMedia(ALICE_SUB, mediaId);
    }
  });
});
