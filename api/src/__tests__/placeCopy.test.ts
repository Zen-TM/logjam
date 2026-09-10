import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

import { throttleWrites } from "./_rateLimitGate";

// A write in here may have to wait out `userPatchLimiter`'s 60-second window
// (see `throttleWrites`): the budget is per user and the file that ran before
// this one may have spent it. That wait is legitimate, and it does not fit the
// suite's 15s default — so this FILE gets a longer one rather than the whole
// suite, where it would mask a genuine hang.
// `hookTimeout` too, not just `testTimeout`: teardown deletes are writes, they
// draw on the same 30/60s per-user budget, and vitest's 10s default for hooks
// is shorter than one window reset — so a suite that passed every assertion
// still failed, in the hook, with a message about nothing.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

import { PLACE_TYPE_COLORS, SYSTEM_PLACE_TYPE_IDS } from "@logjam/shared";

import { API_URL, ALICE_SUB, BOB_SUB, BOB_ID, ALICE_ID, as, CANYON_TYPE_ID } from "./_actors";

// COPYING A SHARED PLACE, from the recipient's side (plan §2.6, §7.1, §7.13,
// §7.16). Everything here is a two-actor test on purpose: the rules being
// pinned are about what one account can see of another's, and a mocked-Prisma
// unit test cannot reach any of them.
//
// The three rules, in the order they are easiest to half-implement:
//
//  1. A sharee of a place whose TYPE they do not own gets `fieldDefsSnapshot`
//     on the delta row. Without it they see bare keys — and this is the same
//     shape of bug as `loadDefRows` filtering to `ownerId`, which hid the
//     SYSTEM definitions from their own owner in phase 1b.
//  2. `foreignFields` is OWNER-PRIVATE: absent from every surface a sharee can
//     reach, and never on a delta row with syncRole "shared". Without it the
//     design inherits the propagation objection that got the notes-dump
//     rejected — B copies A's place, shares it with C, and C reads A's labels.
//  3. A copy of a place of the SENDER's own type named "Campsite" lands on the
//     recipient's SYSTEM Campsite rather than minting a second one.
//
// Requires `make dev`. Run `make seed` first — this file creates and deletes
// types, definitions and places.

const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

const createdTypes: { sub: string; id: string }[] = [];
const createdPlaces: { sub: string; id: string }[] = [];
const createdFields: { sub: string; key: string }[] = [];

// Write-heavy, like placeTypes.test.ts: /place-types and /custom-fields carry
// `userPatchLimiter` (30/60s), which `_rateLimitGate` knows nothing about. Read
// the budget off the response and sleep to the window reset rather than letting
// a 429 present as an assertion failure about copies.
/**
 * Post-write throttle: read the tighter `userPatchLimiter` budget (30/60s on
 * the write routes) off the response and sleep to the window reset when it
 * runs low. `_rateLimitGate` cannot do this — it probes a READ route, so it
 * sees the global limiter and nothing about this one.
 */
async function afterWrite(res: { status: number; headers: Record<string, string> }) {
  await throttleWrites(res);
}

/**
 * The same, for a write that must SUCCEED: if the budget was already spent by
 * the file that ran before this one, the first attempt is a 429 and the retry
 * lands after the window resets. Without it a 429 arrives as an assertion
 * failure about place types, in whichever file happens to run second.
 */
async function write<T extends { status: number; headers: Record<string, string> }>(
  send: () => Promise<T>,
): Promise<T> {
  const first = await send();
  return (await throttleWrites(first)) ? await send() : first;
}

async function makeType(sub: string, name: string): Promise<string> {
  const res = await write(() =>
    request(API_URL)
      .post("/place-types")
      .set(as(sub))
      .send({ name, iconKey: "triangle", color: PLACE_TYPE_COLORS[1] }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  createdTypes.push({ sub, id: res.body.id as string });
  return res.body.id as string;
}

async function makeField(
  sub: string,
  field: { key: string; label: string; type: string; min?: number; max?: number },
  placeTypeIds: string[],
): Promise<void> {
  const res = await write(() =>
    request(API_URL).post("/custom-fields/place").set(as(sub)).send({ field, placeTypeIds }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  createdFields.push({ sub, key: field.key });
}

async function makePlace(
  sub: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await write(() =>
    request(API_URL).post("/places").set(as(sub)).send(body),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  createdPlaces.push({ sub, id: res.body.id as string });
  return res.body as Record<string, unknown>;
}

async function shareWith(sub: string, placeId: string, userId: string) {
  const res = await write(() =>
    request(API_URL)
      .post(`/places/${placeId}/share`)
      .set(as(sub))
      .send({ sharedWithUserId: userId }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

afterAll(async () => {
  for (const { sub, id } of createdPlaces) {
    await request(API_URL).delete(`/places/${id}`).set(as(sub));
  }
  for (const { sub, key } of createdFields) {
    await request(API_URL).delete(`/custom-fields/place/${key}`).set(as(sub));
  }
  for (const { sub, id } of createdTypes) {
    await request(API_URL).delete(`/place-types/${id}`).set(as(sub));
  }
});

describe("a sharee of a place of the sender's own type", () => {
  it("gets the definitions that label its values, not bare keys", async () => {
    const typeId = await makeType(ALICE_SUB, `Cave ${Date.now()}`);
    await makeField(
      ALICE_SUB,
      { key: "passage_m", label: "Passage length (m)", type: "integer", min: 0 },
      [typeId],
    );
    const place = await makePlace(ALICE_SUB, {
      placeTypeId: typeId,
      name: "Snapshot cave",
      latitude: -33.61,
      longitude: 150.31,
      fieldValues: { passage_m: 240 },
    });
    await shareWith(ALICE_SUB, place.id as string, BOB_ID);

    const delta = await request(API_URL)
      .get("/sync/delta")
      .set({ ...as(BOB_SUB), ...CLIENT })
      .query({ limit: 500 });
    expect(delta.status).toBe(200);
    const row = (delta.body.changes.places as Record<string, unknown>[]).find(
      (p) => p.id === place.id,
    );
    expect(row, "bob should see the place he was shared").toBeTruthy();
    expect(row!.syncRole).toBe("shared");
    // THE POINT: labels, from the OWNER's definitions, derived live.
    const snapshot = row!.fieldDefsSnapshot as { key: string; label: string }[];
    expect(snapshot, "a shared place of a user type must carry its defs").toBeTruthy();
    expect(snapshot.find((d) => d.key === "passage_m")?.label).toBe(
      "Passage length (m)",
    );
  });

  it("gets NO snapshot for a system type, which it already holds", async () => {
    const delta = await request(API_URL)
      .get("/sync/delta")
      .set({ ...as(BOB_SUB), ...CLIENT })
      .query({ limit: 500 });
    const canyon = (delta.body.changes.places as Record<string, unknown>[]).find(
      (p) => p.syncRole === "shared" && p.placeTypeId === CANYON_TYPE_ID,
    );
    expect(canyon, "the seed shares canyons with bob").toBeTruthy();
    // Sending one would be sending the recipient rows they already have, on
    // every page, forever.
    expect(canyon!.fieldDefsSnapshot).toBeUndefined();
  });
});

describe("foreignFields is owner-private (§2.6)", () => {
  it("is absent from every surface a sharee can reach", async () => {
    // Alice's own type, with a field bob has no definition for.
    const typeId = await makeType(ALICE_SUB, `Cave ${Date.now()}-p`);
    await makeField(
      ALICE_SUB,
      { key: `permit_${Date.now()}`.slice(0, 20), label: "Permit number", type: "string" },
      [typeId],
    );
    const source = await makePlace(ALICE_SUB, {
      placeTypeId: typeId,
      name: "Private-fields cave",
      latitude: -33.62,
      longitude: 150.32,
      fieldValues: { [createdFields[createdFields.length - 1].key]: "NP-1" },
    });

    // Bob copies it, so HIS copy carries foreignFields...
    await shareWith(ALICE_SUB, source.id as string, BOB_ID);
    const copy = await request(API_URL)
      .post(`/places/${source.id as string}/copy`)
      .set(as(BOB_SUB))
      .send({});
    await afterWrite(copy);
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    createdPlaces.push({ sub: BOB_SUB, id: copy.body.id as string });
    expect(copy.body.foreignFields).toBeTruthy();

    // ...and when bob shares HIS copy on to alice, she must not read alice's
    // own labels back through it — the propagation case that got the
    // notes-dump rejected, with the roles the same shape.
    await shareWith(BOB_SUB, copy.body.id as string, ALICE_ID);

    const detail = await request(API_URL)
      .get(`/places/${copy.body.id as string}`)
      .set(as(ALICE_SUB));
    expect(detail.status).toBe(200);
    expect(detail.body.foreignFields).toBeUndefined();

    const list = await request(API_URL).get("/places/shared").set(as(ALICE_SUB));
    expect(list.status).toBe(200);
    const listed = (list.body as Record<string, unknown>[]).find(
      (p) => p.id === copy.body.id,
    );
    expect(listed, "alice should see the place bob shared").toBeTruthy();
    expect(listed!.foreignFields).toBeUndefined();

    const delta = await request(API_URL)
      .get("/sync/delta")
      .set({ ...as(ALICE_SUB), ...CLIENT })
      .query({ limit: 500 });
    const row = (delta.body.changes.places as Record<string, unknown>[]).find(
      (p) => p.id === copy.body.id,
    );
    expect(row!.syncRole).toBe("shared");
    expect(row!.foreignFields).toBeUndefined();
    // The denylist is one list for every sharee-facing surface, so the OTHER
    // owner-private columns go with it: `importKey` and `importBatchId` are the
    // owner's filing (how and when they bulk-loaded), not part of the record.
    expect(row!.importKey).toBeUndefined();
    expect(row!.importBatchId).toBeUndefined();
    expect(listed!.importBatchId).toBeUndefined();
    expect(detail.body.importKey).toBeUndefined();
  });

  it("cannot be written by a client, on either path", async () => {
    const place = await makePlace(ALICE_SUB, {
      placeTypeId: CANYON_TYPE_ID,
      name: "No forging provenance",
      latitude: -33.63,
      longitude: 150.33,
    });
    const forged = [{ key: "x", label: "X", type: "string", value: "forged" }];

    // REST ignores it (the route reads a fixed field list) …
    const patched = await request(API_URL)
      .patch(`/places/${place.id as string}`)
      .set(as(ALICE_SUB))
      .send({ foreignFields: forged });
    await afterWrite(patched);
    expect(patched.status).toBe(200);
    expect(patched.body.foreignFields).toBeNull();

    // … and the push path REJECTS it, because an unknown key is a per-op 400
    // rather than a silent drop. That rejection IS the scope discipline.
    const pushed = await request(API_URL)
      .post("/sync/push")
      .set({ ...as(ALICE_SUB), ...CLIENT })
      .send({
        protocol: 1,
        ops: [
          {
            opId: "5b9a1c26-1111-4111-8111-5b9a1c261111",
            entity: "place",
            op: "update",
            id: place.id,
            fields: { foreignFields: forged },
          },
        ],
      });
    expect(pushed.status).toBe(200);
    expect(pushed.body.results[0].status).toBe("rejected");
    expect(pushed.body.results[0].error.code).toBe(400);
  });
});

describe("copy reconciliation (§2.6 rules 1 and 3)", () => {
  it("lands a sender's own 'Campsite' on the recipient's SYSTEM Campsite", async () => {
    // The trap: branching on the sender's type KIND would create a second,
    // user-owned Campsite for bob — two Campsite tabs, and the zero-places
    // self-heal never fires because the copy just put a place in the new one.
    const aliceCampsite = await makeType(ALICE_SUB, "Campsite");
    const place = await makePlace(ALICE_SUB, {
      placeTypeId: aliceCampsite,
      name: "Name-matched campsite",
      latitude: -33.64,
      longitude: 150.34,
    });
    await shareWith(ALICE_SUB, place.id as string, BOB_ID);

    const before = await request(API_URL).get("/place-types").set(as(BOB_SUB));
    const beforeCount = (before.body.types as { name: string }[]).filter(
      (t) => t.name.toLowerCase() === "campsite",
    ).length;

    const copy = await request(API_URL)
      .post(`/places/${place.id as string}/copy`)
      .set(as(BOB_SUB))
      .send({});
    await afterWrite(copy);
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    createdPlaces.push({ sub: BOB_SUB, id: copy.body.id as string });

    expect(copy.body.placeTypeId).toBe(SYSTEM_PLACE_TYPE_IDS.campsite);
    expect(copy.body.createdPlaceType).toBe(false);

    const after = await request(API_URL).get("/place-types").set(as(BOB_SUB));
    expect(
      (after.body.types as { name: string }[]).filter(
        (t) => t.name.toLowerCase() === "campsite",
      ).length,
      "no second Campsite may appear",
    ).toBe(beforeCount);
  });

  it("creates a type only when nothing matches, and says that it did", async () => {
    const name = `Sinkhole ${Date.now()}`;
    const senderType = await makeType(ALICE_SUB, name);
    const place = await makePlace(ALICE_SUB, {
      placeTypeId: senderType,
      name: "Unmatched type",
      latitude: -33.65,
      longitude: 150.35,
    });
    await shareWith(ALICE_SUB, place.id as string, BOB_ID);

    const copy = await request(API_URL)
      .post(`/places/${place.id as string}/copy`)
      .set(as(BOB_SUB))
      .send({});
    await afterWrite(copy);
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    createdPlaces.push({ sub: BOB_SUB, id: copy.body.id as string });
    createdTypes.push({ sub: BOB_SUB, id: copy.body.placeTypeId as string });

    expect(copy.body.createdPlaceType).toBe(true);
    const types = await request(API_URL).get("/place-types").set(as(BOB_SUB));
    expect(
      (types.body.types as { id: string; name: string }[]).find(
        (t) => t.id === copy.body.placeTypeId,
      )?.name,
    ).toBe(name);
  });

  it("keeps what the recipient defines and parks what they do not", async () => {
    const stamp = Date.now();
    const senderType = await makeType(ALICE_SUB, `Cave ${stamp}-r`);
    const sharedKey = `depth_${stamp}`.slice(0, 20);
    const strandedKey = `rig_${stamp}`.slice(0, 20);
    await makeField(
      ALICE_SUB,
      { key: sharedKey, label: "Depth", type: "integer" },
      [senderType],
    );
    await makeField(
      ALICE_SUB,
      { key: strandedKey, label: "Rigging notes", type: "string" },
      [senderType],
    );
    // Bob holds the SAME key, same type, on the type the copy will land in —
    // so that one value lands in the field it belongs in, silently.
    const bobType = await makeType(BOB_SUB, `Cave ${stamp}-r`);
    await makeField(BOB_SUB, { key: sharedKey, label: "Depth", type: "integer" }, [
      bobType,
    ]);

    const place = await makePlace(ALICE_SUB, {
      placeTypeId: senderType,
      name: "Reconciled cave",
      latitude: -33.66,
      longitude: 150.36,
      fieldValues: { [sharedKey]: 40, [strandedKey]: "two ropes" },
    });
    await shareWith(ALICE_SUB, place.id as string, BOB_ID);

    const copy = await request(API_URL)
      .post(`/places/${place.id as string}/copy`)
      .set(as(BOB_SUB))
      .send({});
    await afterWrite(copy);
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    createdPlaces.push({ sub: BOB_SUB, id: copy.body.id as string });

    expect(copy.body.placeTypeId).toBe(bobType);
    expect(copy.body.fieldValues).toEqual({ [sharedKey]: 40 });
    expect(copy.body.foreignFields).toEqual([
      { key: strandedKey, label: "Rigging notes", type: "string", value: "two ropes" },
    ]);

    // A COPY OF A COPY clears rather than concatenates: bob shares his copy
    // back and alice copies it, and alice's copy carries no residue of the
    // parking bob is holding.
    await shareWith(BOB_SUB, copy.body.id as string, ALICE_ID);
    const second = await request(API_URL)
      .post(`/places/${copy.body.id as string}/copy`)
      .set(as(ALICE_SUB))
      .send({});
    await afterWrite(second);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    createdPlaces.push({ sub: ALICE_SUB, id: second.body.id as string });
    // Alice defines both keys, so both land as values and nothing is parked.
    expect(second.body.foreignFields).toBeNull();
    expect(second.body.fieldValues).toEqual({ [sharedKey]: 40 });
  });
});

describe("the three things an owner can do with a parked value", () => {
  async function placeWithParkedField(key: string, label: string) {
    const stamp = Date.now();
    const senderType = await makeType(ALICE_SUB, `Cave ${stamp}-a`);
    await makeField(ALICE_SUB, { key, label, type: "string" }, [senderType]);
    const place = await makePlace(ALICE_SUB, {
      placeTypeId: senderType,
      name: "Parked-field cave",
      latitude: -33.67,
      longitude: 150.37,
      fieldValues: { [key]: "hand line" },
    });
    await shareWith(ALICE_SUB, place.id as string, BOB_ID);
    const copy = await request(API_URL)
      .post(`/places/${place.id as string}/copy`)
      .set(as(BOB_SUB))
      .send({ placeTypeId: CANYON_TYPE_ID });
    await afterWrite(copy);
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    createdPlaces.push({ sub: BOB_SUB, id: copy.body.id as string });
    expect(copy.body.foreignFields).toHaveLength(1);
    return copy.body as Record<string, unknown>;
  }

  it("adopts it into the place's own type, value and bounds intact", async () => {
    const key = `rig_a_${Date.now()}`.slice(0, 20);
    const copy = await placeWithParkedField(key, "Rigging");
    const res = await request(API_URL)
      .post(`/places/${copy.id as string}/foreign-fields/${key}`)
      .set(as(BOB_SUB))
      .send({ action: "adopt" });
    await afterWrite(res);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    createdFields.push({ sub: BOB_SUB, key });

    expect(res.body.foreignFields).toBeNull();
    expect((res.body.fieldValues as Record<string, unknown>)[key]).toBe("hand line");

    // The definition is now BOB's, scoped to the type of the place he adopted
    // it on — not to all types, which is a choice the field editor makes.
    const defs = await request(API_URL).get("/custom-fields/place").set(as(BOB_SUB));
    expect(
      (defs.body.fields as { key: string; label: string }[]).find((f) => f.key === key)
        ?.label,
    ).toBe("Rigging");
  });

  it("discards it, taking the value with it", async () => {
    const key = `rig_d_${Date.now()}`.slice(0, 20);
    const copy = await placeWithParkedField(key, "Rigging");
    const res = await request(API_URL)
      .post(`/places/${copy.id as string}/foreign-fields/${key}`)
      .set(as(BOB_SUB))
      .send({ action: "discard" });
    await afterWrite(res);
    expect(res.status).toBe(200);
    expect(res.body.foreignFields).toBeNull();
    expect(res.body.fieldValues).toEqual({});
  });

  it("appends it to the notes as one labelled line", async () => {
    const key = `rig_n_${Date.now()}`.slice(0, 20);
    const copy = await placeWithParkedField(key, "Rigging");
    const res = await request(API_URL)
      .post(`/places/${copy.id as string}/foreign-fields/${key}`)
      .set(as(BOB_SUB))
      .send({ action: "notes" });
    await afterWrite(res);
    expect(res.status).toBe(200);
    expect(res.body.notes).toContain("Rigging: hand line");
    expect(res.body.foreignFields).toBeNull();
  });

  it("is owner-only, and answers a non-owner with a 404", async () => {
    const key = `rig_o_${Date.now()}`.slice(0, 20);
    const copy = await placeWithParkedField(key, "Rigging");
    // Bob's copy is not shared with alice at all: the status must not confirm
    // the place exists, let alone that it has parked fields.
    const res = await request(API_URL)
      .post(`/places/${copy.id as string}/foreign-fields/${key}`)
      .set(as(ALICE_SUB))
      .send({ action: "discard" });
    expect(res.status).toBe(404);
  });

  it("rejects an action it does not have", async () => {
    const key = `rig_x_${Date.now()}`.slice(0, 20);
    const copy = await placeWithParkedField(key, "Rigging");
    const res = await request(API_URL)
      .post(`/places/${copy.id as string}/foreign-fields/${key}`)
      .set(as(BOB_SUB))
      .send({ action: "appendToEverything" });
    expect(res.status).toBe(400);
  });
});

describe("a place-type change parks what the new type cannot hold", () => {
  it("moves the stranded value rather than deleting or hiding it", async () => {
    const stamp = Date.now();
    const key = `sump_${stamp}`.slice(0, 20);
    const typeId = await makeType(ALICE_SUB, `Cave ${stamp}-t`);
    await makeField(ALICE_SUB, { key, label: "Sump length", type: "integer" }, [
      typeId,
    ]);
    const place = await makePlace(ALICE_SUB, {
      placeTypeId: typeId,
      name: "Retyped cave",
      latitude: -33.68,
      longitude: 150.38,
      fieldValues: { [key]: 12 },
    });

    // Retype it to Canyon, which has no definition for that key.
    const pushed = await request(API_URL)
      .post("/sync/push")
      .set({ ...as(ALICE_SUB), ...CLIENT })
      .send({
        protocol: 1,
        ops: [
          {
            opId: `${stamp}`.padStart(8, "0").slice(0, 8) + "-2222-4222-8222-222222222222",
            entity: "place",
            op: "update",
            id: place.id,
            fields: { placeTypeId: CANYON_TYPE_ID },
          },
        ],
      });
    expect(pushed.status).toBe(200);
    expect(pushed.body.results[0].status, JSON.stringify(pushed.body.results[0])).toBe(
      "applied",
    );

    const row = pushed.body.results[0].row as Record<string, unknown>;
    expect(row.placeTypeId).toBe(CANYON_TYPE_ID);
    // Not in fieldValues (nothing would render it) and not deleted (the user
    // typed it): parked, labelled, adoptable.
    expect(row.fieldValues).toEqual({});
    expect(row.foreignFields).toEqual([
      { key, label: "Sump length", type: "integer", value: 12 },
    ]);
  });
});
