import request from "supertest";

import { API_URL, as } from "./_actors";

// Delta-pull helpers for the tests that hold "a hard delete of a synced entity
// writes its tombstone". A test takes `deltaCursor` BEFORE the delete, then
// asks `tombstonesSince` and expects the id of a row IT created: only the
// delete under test can have written that id's tombstone.

const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

export type Tombstone = { type: string; id: string };

/** Drain GET /sync/delta from `cursor`; the tombstones and the final cursor. */
export async function pullDelta(
  sub: string,
  cursor = "",
): Promise<{ tombstones: Tombstone[]; cursor: string }> {
  const tombstones: Tombstone[] = [];
  for (let pages = 0; pages < 500; pages += 1) {
    const res = await request(API_URL)
      .get("/sync/delta")
      .query({ cursor })
      .set(as(sub))
      .set(CLIENT);
    if (res.status !== 200 || res.body.resetRequired) {
      throw new Error(`delta pull failed: ${res.status}`);
    }
    tombstones.push(...res.body.tombstones);
    cursor = res.body.cursor;
    if (!res.body.hasMore) return { tombstones, cursor };
  }
  throw new Error("delta paging did not terminate");
}

/** A cursor at the end of everything `sub` can see right now. */
export async function deltaCursor(sub: string): Promise<string> {
  return (await pullDelta(sub)).cursor;
}

export async function tombstonesSince(
  sub: string,
  cursor: string,
): Promise<Tombstone[]> {
  return (await pullDelta(sub, cursor)).tombstones;
}

// 1x1 transparent PNG; the server only reads the uploaded object's size.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

/** Attach a photo to a place or trip log `sub` owns; the media id. */
export async function uploadPhoto(
  sub: string,
  linkedType: "place" | "tripLog",
  linkedId: string,
): Promise<string> {
  const body = {
    linkedType,
    linkedId,
    filename: "photo.png",
    mediaType: "image/png",
  };
  const presign = await request(API_URL)
    .post("/media/presign")
    .set(as(sub))
    .send({
      ...body,
      sizeBytes: PNG.length,
      thumbnailSizeBytes: PNG.length,
    });
  if (presign.status !== 201) throw new Error(`presign ${presign.status}`);
  const { mediaId, displayUploadUrl, thumbnailUploadUrl } = presign.body;
  for (const [url, type] of [
    [displayUploadUrl, "image/png"],
    [thumbnailUploadUrl, "image/jpeg"],
  ]) {
    const put = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": type },
      body: PNG,
    });
    if (!put.ok) throw new Error(`upload ${put.status}`);
  }
  const confirm = await request(API_URL)
    .post(`/media/${mediaId}/confirm`)
    .set(as(sub))
    .send(body);
  if (confirm.status !== 201) throw new Error(`confirm ${confirm.status}`);
  return mediaId as string;
}
