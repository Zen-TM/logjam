import { describe, it, expect } from "vitest";
import request from "supertest";
import {
  DELTA_ENTITY_ORDER,
  parseSyncDeltaCustomFieldDefRow,
  parseSyncDeltaFriendshipRow,
  parseSyncDeltaMediaRow,
  parseSyncDeltaPlaceRow,
  parseSyncDeltaPlaceTypeRow,
  parseSyncDeltaRouteRow,
  parseSyncDeltaShareRow,
  parseSyncDeltaTombstone,
  parseSyncDeltaTripRow,
} from "@logjam/shared";

import {
  API_URL,
  ALICE_SUB,
  BOB_SUB,
  CAROL_SUB,
  BOB_ID,
  SHARED_PLACE_ID,
  as,
  CANYON_TYPE_ID
} from "./_actors";

// Stage 8 §11 mandatory privacy-boundary suite for GET /sync/delta.
// Requires `make dev`. Seed baseline: alice owns SHARED_PLACE_ID, shared
// with bob; carol is shared nothing. Synthetic coords only.

const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

function delta(sub: string, query: Record<string, string> = {}) {
  return request(API_URL)
    .get("/sync/delta")
    .query(query)
    .set(as(sub))
    .set(CLIENT);
}

// Drain a full paged pull; returns merged changes + tombstones + final cursor.
async function fullPull(sub: string, cursor = "", limit?: number) {
  const changes: Record<string, unknown[]> = {};
  const tombstones: { type: string; id: string }[] = [];
  let pages = 0;
  for (;;) {
    const res = await delta(sub, {
      cursor,
      ...(limit !== undefined && { limit: String(limit) }),
    });
    expect(res.status).toBe(200);
    expect(res.body.resetRequired).toBe(false);
    for (const [key, rows] of Object.entries(res.body.changes)) {
      changes[key] = [...(changes[key] ?? []), ...(rows as unknown[])];
    }
    tombstones.push(...res.body.tombstones);
    cursor = res.body.cursor;
    pages += 1;
    expect(pages).toBeLessThan(500); // paging must terminate
    if (!res.body.hasMore) break;
  }
  return { changes, tombstones, cursor, pages };
}

describe("sync delta — request contract", () => {
  it("requires the x-logjam-client header (400 without)", async () => {
    const res = await request(API_URL).get("/sync/delta").set(as(ALICE_SUB));
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range limit", async () => {
    expect((await delta(ALICE_SUB, { limit: "0" })).status).toBe(400);
    expect((await delta(ALICE_SUB, { limit: "1001" })).status).toBe(400);
    expect((await delta(ALICE_SUB, { limit: "abc" })).status).toBe(400);
  });

  it("garbage cursor → resetRequired, never an error", async () => {
    const res = await delta(ALICE_SUB, { cursor: "!!!not-a-cursor!!!" });
    expect(res.status).toBe(200);
    expect(res.body.resetRequired).toBe(true);
    expect(res.body.cursor).toBe("");
  });
});

describe("sync delta — owner view", () => {
  it("initial pull returns alice's places/trips and advances the cursor", async () => {
    const { changes, cursor } = await fullPull(ALICE_SUB);
    const places = changes.places as { id: string; syncRole: string }[];
    expect(places.some((c) => c.id === SHARED_PLACE_ID)).toBe(true);
    expect(
      places
        .filter((c) => c.id === SHARED_PLACE_ID)
        .every((c) => c.syncRole === "owner"),
    ).toBe(true);
    expect((changes.tripLogs as unknown[]).length).toBeGreaterThan(0);
    expect(cursor).not.toBe("");

    // Steady state: an immediate re-pull from the advanced cursor returns
    // only the overlap window (idempotent re-delivery, no reset).
    const res = await delta(ALICE_SUB, { cursor });
    expect(res.status).toBe(200);
    expect(res.body.resetRequired).toBe(false);
  });

  it("paged pull (limit=5) terminates and matches the unpaged set", async () => {
    const whole = await fullPull(ALICE_SUB);
    const paged = await fullPull(ALICE_SUB, "", 5);
    expect(paged.pages).toBeGreaterThan(1);
    for (const key of Object.keys(whole.changes)) {
      const wholeIds = new Set(
        (whole.changes[key] as { id: string }[]).map((r) => r.id),
      );
      const pagedIds = new Set(
        (paged.changes[key] as { id: string }[]).map((r) => r.id),
      );
      expect(pagedIds).toEqual(wholeIds);
    }
  });
});

describe("sync delta — sharee view (bob)", () => {
  it("contains the shared place (role shared) + its place media, zero foreign trips/trip-media", async () => {
    const { changes } = await fullPull(BOB_SUB);
    const places = changes.places as {
      id: string;
      syncRole: string;
      ownerId: string;
    }[];
    const shared = places.find((c) => c.id === SHARED_PLACE_ID);
    expect(shared).toBeTruthy();
    expect(shared!.syncRole).toBe("shared");

    // Owner-private data must be absent: no alice trips, no trip-linked
    // media of another owner, no _count aggregates.
    const trips = changes.tripLogs as { userId?: string }[];
    expect(trips.every((t) => t.userId === undefined || t.userId === BOB_ID)).toBe(
      true,
    );
    const media = changes.media as { linkedType: string; linkedId: string }[];
    // (bob's own trip media would be legal; foreign trip media never.)
    const bobTripIds = new Set(
      (changes.tripLogs as { id: string }[]).map((t) => t.id),
    );
    expect(
      media
        .filter((m) => m.linkedType === "tripLog")
        .every((m) => bobTripIds.has(m.linkedId)),
    ).toBe(true);
    for (const place of places.filter((c) => c.syncRole === "shared")) {
      expect((place as Record<string, unknown>)._count).toBeUndefined();
    }
  });

  it("cannot enumerate co-sharees and never sees an email anywhere", async () => {
    const { changes } = await fullPull(BOB_SUB);
    const shares = changes.placeShares as {
      sharedById: string;
      sharedWithId: string;
    }[];
    // Every share row involves bob himself.
    expect(
      shares.every(
        (s) => s.sharedById === BOB_ID || s.sharedWithId === BOB_ID,
      ),
    ).toBe(true);
    // No email key anywhere in the whole response.
    expect(JSON.stringify(changes)).not.toContain('"email"');
  });
});

describe("sync delta — stranger view (carol)", () => {
  it("contains nothing of alice's", async () => {
    const { changes } = await fullPull(CAROL_SUB);
    const placeIds = (changes.places as { id: string }[]).map((c) => c.id);
    expect(placeIds).not.toContain(SHARED_PLACE_ID);
    const json = JSON.stringify(changes);
    expect(json).not.toContain(SHARED_PLACE_ID);
  });
});

describe("sync delta — revocation signals", () => {
  it("unshare emits a place tombstone to the sharee; place-delete emits the identical signal", async () => {
    // Alice creates a place and shares it with bob.
    const created = await request(API_URL)
      .post("/places")
      .set(as(ALICE_SUB))
      .send({ placeTypeId: CANYON_TYPE_ID, name: "Tombstone place", latitude: -33.69, longitude: 150.29 });
    expect(created.status).toBe(201);
    const placeId = created.body.id as string;
    const share = await request(API_URL)
      .post(`/places/${placeId}/share`)
      .set(as(ALICE_SUB))
      .send({ sharedWithUserId: BOB_ID });
    expect(share.status).toBe(201);

    // Bob syncs to a steady-state cursor that has seen the place.
    const bobBefore = await fullPull(BOB_SUB);
    expect(
      (bobBefore.changes.places as { id: string }[]).some(
        (c) => c.id === placeId,
      ),
    ).toBe(true);

    // UNSHARE → bob's next delta: place tombstone, no place row.
    const revoke = await request(API_URL)
      .delete(`/places/${placeId}/share/${BOB_ID}`)
      .set(as(ALICE_SUB));
    expect(revoke.status).toBe(204);

    const afterUnshare = await fullPull(BOB_SUB, bobBefore.cursor);
    expect(
      afterUnshare.tombstones.some(
        (t) => t.type === "place" && t.id === placeId,
      ),
    ).toBe(true);
    expect(
      (afterUnshare.changes.places as { id: string }[]).some(
        (c) => c.id === placeId,
      ),
    ).toBe(false);

    // Re-share, then DELETE the place → the sharee-visible signal must be
    // indistinguishable from the unshare (a bare place tombstone).
    const reshare = await request(API_URL)
      .post(`/places/${placeId}/share`)
      .set(as(ALICE_SUB))
      .send({ sharedWithUserId: BOB_ID });
    expect(reshare.status).toBe(201);
    const bobMid = await fullPull(BOB_SUB, afterUnshare.cursor);

    const del = await request(API_URL)
      .delete(`/places/${placeId}`)
      .set(as(ALICE_SUB));
    expect(del.status).toBe(204);

    const afterDelete = await fullPull(BOB_SUB, bobMid.cursor);
    expect(
      afterDelete.tombstones.some(
        (t) => t.type === "place" && t.id === placeId,
      ),
    ).toBe(true);
    // Signal shape parity: same tombstone type, no extra sharee-visible rows
    // that would distinguish delete from unshare.
    expect(
      (afterDelete.changes.places as { id: string }[]).some(
        (c) => c.id === placeId,
      ),
    ).toBe(false);
  });
});

describe("sync meta", () => {
  it("GET /meta exposes the sync capability block", async () => {
    const res = await request(API_URL).get("/meta").set(as(ALICE_SUB));
    expect(res.status).toBe(200);
    expect(res.body.sync.protocols).toEqual([1]);
    expect(res.body.sync.pushMaxOps).toBe(50);
    expect(res.body.sync.deltaMaxLimit).toBe(1000);
  });
});

describe("media download-urls boundary", () => {
  it("returns URLs for visible media, silently omits foreign ids", async () => {
    // A media id bob can see: place-level media on the shared place (if
    // any); build one deterministic case instead: alice attaches media via
    // presign+confirm is heavy — use omission check only with a fake id.
    const res = await request(API_URL)
      .post("/media/download-urls")
      .set(as(BOB_SUB))
      .send({ ids: ["00000000-0000-4000-8000-00000000dead"] });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);

    const bad = await request(API_URL)
      .post("/media/download-urls")
      .set(as(BOB_SUB))
      .send({ ids: [] });
    expect(bad.status).toBe(400);

    const tooMany = await request(API_URL)
      .post("/media/download-urls")
      .set(as(BOB_SUB))
      .send({ ids: Array.from({ length: 101 }, (_, i) => String(i)) });
    expect(tooMany.status).toBe(413);
  });
});

// THE ROW SPECS ARE A CONTRACT WITH THE PHONE, AND ONLY THE SERVER KNOWS WHAT
// IT ACTUALLY SENDS.
//
// `shared/src/sync.ts` declares what a delta row must look like, and the mobile
// pull runs every row through it — a row that fails is DROPPED, with a warning
// that reads as data loss. Every test of those parsers, on both sides, built
// its rows by hand, so a spec that disagreed with the server was invisible to
// all of them: `ownerId: isString` on a custom field definition dropped all
// NINE system definitions off every page a phone pulled (grades arriving on
// places with nothing to label or bound them), and it took running the app to
// see it. This is that class of bug's guard — the rows come from the live
// server, so at least one side is ground truth.
const ROW_PARSERS: Record<string, (row: unknown) => unknown> = {
  placeTypes: parseSyncDeltaPlaceTypeRow,
  customFieldDefs: parseSyncDeltaCustomFieldDefRow,
  places: parseSyncDeltaPlaceRow,
  tripLogs: parseSyncDeltaTripRow,
  routes: parseSyncDeltaRouteRow,
  media: parseSyncDeltaMediaRow,
  placeShares: parseSyncDeltaShareRow,
  friendships: parseSyncDeltaFriendshipRow,
};

describe("sync delta — every row the server sends parses on the client", () => {
  it("parses each row of a full pull through the shared spec", async () => {
    for (const sub of [ALICE_SUB, BOB_SUB]) {
      const { changes, tombstones } = await fullPull(sub);
      // `placeLinks` has no exported parser — the mirror stores it whole — so
      // the map is checked against the delta's own entity list rather than
      // assumed complete.
      for (const key of Object.keys(changes)) {
        expect(
          (DELTA_ENTITY_ORDER as readonly string[]).includes(key),
          `the delta carries "${key}", which is not in DELTA_ENTITY_ORDER`,
        ).toBe(true);
      }
      for (const [key, parse] of Object.entries(ROW_PARSERS)) {
        for (const row of changes[key] ?? []) {
          expect(
            () => parse(row),
            `${sub} pulled a ${key} row the client spec rejects: ${JSON.stringify(row)}`,
          ).not.toThrow();
        }
      }
      for (const tombstone of tombstones) {
        expect(() => parseSyncDeltaTombstone(tombstone)).not.toThrow();
      }
    }
  });

  // The case that actually broke: a SYSTEM definition belongs to no account.
  it("sends system definitions with a null owner, and the spec accepts them", async () => {
    const { changes } = await fullPull(ALICE_SUB);
    const defs = (changes.customFieldDefs ?? []) as { ownerId: string | null }[];
    expect(defs.length).toBeGreaterThan(0);
    const system = defs.filter((def) => def.ownerId === null);
    expect(system.length, "the seven grades and their kin are global rows").toBeGreaterThan(0);
    for (const def of system) {
      expect(() => parseSyncDeltaCustomFieldDefRow(def)).not.toThrow();
    }
  });
});
