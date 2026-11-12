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
