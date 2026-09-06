import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import {
  API_URL,
  ALICE_SUB,
  BOB_SUB,
  BOB_ID,
  BOB_SHARED_PLACE_ID,
  as,
  CANYON_TYPE_ID,
  MARKER_TYPE_ID,
} from "./_actors";

// The delta endpoint requires the client-version header (the forced-upgrade
// lever reads it), so a sync request without one is a 400 before it ever
// reaches the visibility logic under test here.
const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

// PLACE LINKS, from the outside. This file was `waypoints.test.ts` until the
// phase 1c fold: a waypoint is a place of the system Marker type now, so its
// CRUD is `places.test.ts`'s and what is left here is the LINK — the thing a
// waypoint's `canyonIds` used to be.
//
// The rule the whole file exists to pin: **a link grants NO visibility.**
// Sharing is per place, explicit, through PlaceShare. Linking a carpark to a
// canyon someone else can see must not hand them the carpark, and must not
// tell them the carpark exists.
//
// Requires `make dev` (API on :8080, AUTH_MODE=fake).
// Synthetic coords only (committed-fixture rule).

async function createMarker(sub: string, name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/places")
    .set(as(sub))
    .send({
      placeTypeId: MARKER_TYPE_ID,
      name,
      latitude: -33.65,
      longitude: 150.25,
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function del(sub: string, placeId: string): Promise<void> {
  await request(API_URL).delete(`/places/${placeId}`).set(as(sub));
}

describe("place links over REST", () => {
  it("links, reads back from BOTH ends, and unlinks", async () => {
    const carpark = await createMarker(ALICE_SUB, "Trailhead carpark");
    const canyon = await request(API_URL)
      .post("/places")
      .set(as(ALICE_SUB))
      .send({
        placeTypeId: CANYON_TYPE_ID,
        name: "Linked canyon",
        latitude: -33.66,
        longitude: 150.26,
        linkedPlaceIds: [carpark],
      });
    expect(canyon.status).toBe(201);
    expect(canyon.body.linkedPlaceIds).toEqual([carpark]);

    // Symmetric and stored once: the carpark sees the canyon without anyone
    // having written a second row.
    const fromCarpark = await request(API_URL)
      .get(`/places/${carpark}`)
      .set(as(ALICE_SUB));
    expect(fromCarpark.status).toBe(200);
    expect(fromCarpark.body.linkedPlaceIds).toEqual([canyon.body.id]);

    // The whole-list write is a replacement: [] clears.
    const cleared = await request(API_URL)
      .patch(`/places/${canyon.body.id as string}`)
      .set(as(ALICE_SUB))
      .send({ linkedPlaceIds: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.linkedPlaceIds).toEqual([]);

    const afterClear = await request(API_URL)
      .get(`/places/${carpark}`)
      .set(as(ALICE_SUB));
    expect(afterClear.body.linkedPlaceIds).toEqual([]);
    // Both places survive an unlink — a link is not a container.
    expect(afterClear.status).toBe(200);

    await del(ALICE_SUB, canyon.body.id as string);
    await del(ALICE_SUB, carpark);
  });

  it("refuses a foreign or nonexistent endpoint with the same 404", async () => {
    const mine = await createMarker(ALICE_SUB, "My marker");

    // A place that exists but is bob's, and one that exists nowhere: the
    // status must not tell them apart (404-not-403 anti-oracle).
    for (const other of [BOB_SHARED_PLACE_ID, "00000000-0000-4000-8000-000000000000"]) {
      const res = await request(API_URL)
        .patch(`/places/${mine}`)
        .set(as(ALICE_SUB))
        .send({ linkedPlaceIds: [other] });
      expect(res.status, other).toBe(404);
    }

    await del(ALICE_SUB, mine);
  });

  it("drops a self-link rather than storing one", async () => {
    const mine = await createMarker(ALICE_SUB, "Self linker");
    const res = await request(API_URL)
      .patch(`/places/${mine}`)
      .set(as(ALICE_SUB))
      .send({ linkedPlaceIds: [mine] });
    expect(res.status).toBe(200);
    expect(res.body.linkedPlaceIds).toEqual([]);
    await del(ALICE_SUB, mine);
  });

  it("deleting a place takes its links and leaves the other end standing", async () => {
    const carpark = await createMarker(ALICE_SUB, "Doomed carpark");
    const canyon = await request(API_URL)
      .post("/places")
      .set(as(ALICE_SUB))
      .send({
        placeTypeId: CANYON_TYPE_ID,
        name: "Surviving canyon",
        latitude: -33.66,
        longitude: 150.26,
        linkedPlaceIds: [carpark],
      });
    expect(canyon.status).toBe(201);

    await del(ALICE_SUB, carpark);

    const survivor = await request(API_URL)
      .get(`/places/${canyon.body.id as string}`)
      .set(as(ALICE_SUB));
    expect(survivor.status).toBe(200);
    expect(survivor.body.linkedPlaceIds).toEqual([]);

    await del(ALICE_SUB, canyon.body.id as string);
  });
});

describe("a link grants no visibility (§2.5)", () => {
  it("does not carry a linked place to the sharee of the place it hangs off", async () => {
    // Alice links a private carpark to a place bob CAN see. Under the old
    // waypoint model this handed bob the carpark; under links it must not.
    const carpark = await createMarker(ALICE_SUB, "Private carpark");
    const shared = await request(API_URL)
      .post("/places")
      .set(as(ALICE_SUB))
      .send({
        placeTypeId: CANYON_TYPE_ID,
        name: "Canyon to share",
        latitude: -33.69,
        longitude: 150.29,
        linkedPlaceIds: [carpark],
      });
    expect(shared.status).toBe(201);

    const share = await request(API_URL)
      .post(`/places/${shared.body.id as string}/share`)
      .set(as(ALICE_SUB))
      .send({ sharedWithUserId: BOB_ID });
    expect(share.status).toBe(201);

    // The shared place itself: visible, and with NO link list on it — the
    // owner's filing is owner-private.
    const seen = await request(API_URL)
      .get(`/places/${shared.body.id as string}`)
      .set(as(BOB_SUB));
    expect(seen.status).toBe(200);
    expect(seen.body.linkedPlaceIds).toBeUndefined();

    // The carpark at the other end: 404, not 403 — bob must not learn it
    // exists at all.
    const probe = await request(API_URL).get(`/places/${carpark}`).set(as(BOB_SUB));
    expect(probe.status).toBe(404);

    await del(ALICE_SUB, shared.body.id as string);
    await del(ALICE_SUB, carpark);
  });

  it("sends a sharee no link rows at all in their delta", async () => {
    const carpark = await createMarker(ALICE_SUB, "Delta carpark");
    const canyon = await request(API_URL)
      .post("/places")
      .set(as(ALICE_SUB))
      .send({
        placeTypeId: CANYON_TYPE_ID,
        name: "Delta canyon",
        latitude: -33.7,
        longitude: 150.3,
        linkedPlaceIds: [carpark],
      });
    expect(canyon.status).toBe(201);
    await request(API_URL)
      .post(`/places/${canyon.body.id as string}/share`)
      .set(as(ALICE_SUB))
      .send({ sharedWithUserId: BOB_ID });

    // Alice's own delta carries the link; bob's carries none of hers.
    const mine = await request(API_URL)
      .get("/sync/delta")
      .set({ ...as(ALICE_SUB), ...CLIENT })
      .query({ limit: 500 });
    expect(mine.status).toBe(200);
    const linkIds = (mine.body.changes.placeLinks as { id: string }[]).map((l) => l.id);
    expect(linkIds.length).toBeGreaterThan(0);

    const theirs = await request(API_URL)
      .get("/sync/delta")
      .set({ ...as(BOB_SUB), ...CLIENT })
      .query({ limit: 500 });
    expect(theirs.status).toBe(200);
    const theirLinks = theirs.body.changes.placeLinks as {
      aPlaceId: string;
      bPlaceId: string;
    }[];
    // Bob may have links of his OWN (the seed gives him one); what he must
    // never have is a link naming a place of alice's.
    for (const link of theirLinks) {
      expect([link.aPlaceId, link.bPlaceId]).not.toContain(carpark);
      expect([link.aPlaceId, link.bPlaceId]).not.toContain(canyon.body.id);
    }

    await del(ALICE_SUB, canyon.body.id as string);
    await del(ALICE_SUB, carpark);
  });
});

describe("place links over the sync push protocol", () => {
  // The client-facing shape: per-link create/delete ops with client-minted
  // ids, NOT a whole-list field on the place row (§6). Two devices linking the
  // same pair collide on the unique index instead of clobbering each other.
  function opEnvelope(ops: unknown[]) {
    return { protocol: 1, ops };
  }

  it("creates a link, canonicalises the pair, and is idempotent on replay", async () => {
    const first = await createMarker(ALICE_SUB, "Push marker A");
    const second = await createMarker(ALICE_SUB, "Push marker B");
    // Minted per run, not pinned: the delete at the end leaves a TOMBSTONE for
    // the id, and `createAlreadyTombstoned` then answers alreadyApplied to any
    // later create of it — correct protocol behaviour (delete wins, §6), and
    // it makes a hardcoded id single-use.
    const linkId = randomUUID();
    const op = {
      opId: randomUUID(),
      entity: "placeLink",
      op: "create",
      id: linkId,
      // Deliberately the HIGH id first — the server stores the canonical order.
      fields: { aPlaceId: second, bPlaceId: first },
    };

    const res = await request(API_URL)
      .post("/sync/push")
      .set({ ...as(ALICE_SUB), ...CLIENT })
      .send(opEnvelope([op]));
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("applied");
    const [low, high] = [first, second].sort();
    expect(res.body.results[0].row.aPlaceId).toBe(low);
    expect(res.body.results[0].row.bPlaceId).toBe(high);

    // Replay of the same op: alreadyApplied, never a duplicate.
    const replay = await request(API_URL)
      .post("/sync/push")
      .set({ ...as(ALICE_SUB), ...CLIENT })
      .send(opEnvelope([{ ...op, opId: randomUUID() }]));
    expect(replay.status).toBe(200);
    expect(replay.body.results[0].status).toBe("alreadyApplied");

    // A SECOND device links the same pair from the other end with its own
    // client-minted id — the pair, not the id, is what must not duplicate.
    const other = await request(API_URL)
      .post("/sync/push")
      .set({ ...as(ALICE_SUB), ...CLIENT })
      .send(
        opEnvelope([
          {
            opId: randomUUID(),
            entity: "placeLink",
            op: "create",
            id: randomUUID(),
            fields: { aPlaceId: first, bPlaceId: second },
          },
        ]),
      );
    expect(other.status).toBe(200);
    expect(other.body.results[0].status).toBe("alreadyApplied");
    expect(other.body.results[0].row.id).toBe(linkId);

    // §7.18, the round trip: what was pushed comes back down the delta, and
    // the link arrives with both of its endpoints — a link whose places were
    // not delivered renders as nothing on the phone.
    const delta = await request(API_URL)
      .get("/sync/delta")
      .set({ ...as(ALICE_SUB), ...CLIENT })
      .query({ limit: 500 });
    expect(delta.status).toBe(200);
    const placeIds = (delta.body.changes.places as { id: string }[]).map((p) => p.id);
    expect(placeIds).toContain(first);
    expect(placeIds).toContain(second);
    const link = (delta.body.changes.placeLinks as { id: string }[]).find(
      (l) => l.id === linkId,
    );
    expect(link, "the pushed link should come back down the delta").toBeTruthy();
    // Dependency order (DELTA_ENTITY_ORDER): places before the links that
    // name them, so a client applying a page never holds a link to a row it
    // has not been given.
    const keys = Object.keys(delta.body.changes);
    expect(keys.indexOf("places")).toBeLessThan(keys.indexOf("placeLinks"));

    // Delete leaves both places standing and tombstones the link for the owner.
    const removed = await request(API_URL)
      .post("/sync/push")
      .set({ ...as(ALICE_SUB), ...CLIENT })
      .send(
        opEnvelope([
          {
            opId: randomUUID(),
            entity: "placeLink",
            op: "delete",
            id: linkId,
          },
        ]),
      );
    expect(removed.status).toBe(200);
    expect(removed.body.results[0].status).toBe("applied");

    const stillThere = await request(API_URL)
      .get(`/places/${first}`)
      .set(as(ALICE_SUB));
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.linkedPlaceIds).toEqual([]);

    await del(ALICE_SUB, first);
    await del(ALICE_SUB, second);
  });

  it("refuses an endpoint the caller does not own, with the same 404", async () => {
    const mine = await createMarker(ALICE_SUB, "Push marker C");
    const res = await request(API_URL)
      .post("/sync/push")
      .set({ ...as(ALICE_SUB), ...CLIENT })
      .send(
        opEnvelope([
          {
            opId: randomUUID(),
            entity: "placeLink",
            op: "create",
            id: randomUUID(),
            fields: { aPlaceId: mine, bPlaceId: BOB_SHARED_PLACE_ID },
          },
        ]),
      );
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("rejected");
    expect(res.body.results[0].error.code).toBe(404);

    await del(ALICE_SUB, mine);
  });

  it("has no update op — a link has no field to change", async () => {
    const first = await createMarker(ALICE_SUB, "Push marker D");
    const second = await createMarker(ALICE_SUB, "Push marker E");
    const res = await request(API_URL)
      .post("/sync/push")
      .set({ ...as(ALICE_SUB), ...CLIENT })
      .send(
        opEnvelope([
          {
            opId: randomUUID(),
            entity: "placeLink",
            op: "update",
            id: randomUUID(),
            fields: { aPlaceId: first, bPlaceId: second },
          },
        ]),
      );
    // Envelope-level rejection: the op vocabulary is per entity, so `update`
    // is not a thing a link op can even say.
    expect(res.status).toBe(400);

    await del(ALICE_SUB, first);
    await del(ALICE_SUB, second);
  });
});

describe("trip updatedAt watermark (stage8 §3.1 trap)", () => {
  it("a placeIds-only PATCH bumps the trip's updatedAt", async () => {
    const place = await request(API_URL)
      .post("/places")
      .set(as(ALICE_SUB))
      .send({
        placeTypeId: CANYON_TYPE_ID,
        name: "Watermark place",
        latitude: -33.66,
        longitude: 150.26,
      });
    expect(place.status).toBe(201);

    const trip = await request(API_URL)
      .post("/trips")
      .set(as(ALICE_SUB))
      .send({ date: "2026-07-01" });
    expect(trip.status).toBe(201);
    expect(trip.body.updatedAt).toBeDefined();
    const before = new Date(trip.body.updatedAt as string).getTime();

    // Ensure the clock can visibly advance past the create timestamp.
    await new Promise((r) => setTimeout(r, 25));

    const patch = await request(API_URL)
      .patch(`/trips/${trip.body.id as string}`)
      .set(as(ALICE_SUB))
      .send({ placeIds: [place.body.id] });
    expect(patch.status).toBe(200);
    const after = new Date(patch.body.updatedAt as string).getTime();
    // The link change MUST move the row past the delta watermark.
    expect(after).toBeGreaterThan(before);

    // teardown (place delete backfills the trip name; delete trip too)
    await request(API_URL)
      .delete(`/trips/${trip.body.id as string}`)
      .set(as(ALICE_SUB));
    await del(ALICE_SUB, place.body.id as string);
  });
});
