import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

import { throttleWrites } from "./_rateLimitGate";

// A write in here may have to wait out `userPatchLimiter`'s 60-second window
// (see `throttleWrites`): the budget is per user and the file that ran before
// this one may have spent it. That wait is legitimate, and it does not fit the
// suite's 15s default — so this FILE gets a longer one rather than the whole
// suite, where it would mask a genuine hang.
vi.setConfig({ testTimeout: 90_000 });

import {
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPE_IDS,
  SYSTEM_PLACE_TYPES,
} from "@logjam/shared";

import { API_URL, ALICE_SUB, BOB_SUB, as, CANYON_TYPE_ID} from "./_actors";

// Place types and the field definitions scoped to them — the mandatory guards
// from the places-rework plan §7.4, §7.6 and §7.7.
//
// Requires `make dev` (Postgres + MiniStack + API on :8080) with AUTH_MODE=fake.
// Run `make seed` first: this suite creates and deletes types, and the seed is
// what puts the system rows back.

const created: string[] = [];
const createdFields: string[] = [];

// This file is WRITE-heavy — every type and definition it exercises is a POST
// or PATCH — and those routes carry `userPatchLimiter` (30/60s, keyed per user,
// falling back to IP). `_rateLimitGate` guards the GLOBAL 300/60s limiter and
// knows nothing about this tighter one, so the file throttles itself the same
// way: read the budget off the response and sleep to the window reset when it
// runs low. Without it the run dissolves into 429s that look like assertion
// failures about types.
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
      .send({ name, iconKey: "map-pin", color: "#22C55E" }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(res.body.id);
  return res.body.id as string;
}

afterAll(async () => {
  for (const key of createdFields) {
    await request(API_URL).delete(`/custom-fields/place/${key}`).set(as(ALICE_SUB));
  }
  for (const id of created) {
    await request(API_URL).delete(`/place-types/${id}`).set(as(ALICE_SUB));
    await request(API_URL).delete(`/place-types/${id}`).set(as(BOB_SUB));
  }
});

describe("GET /place-types", () => {
  it("lists the system types alongside the caller's own", async () => {
    const res = await request(API_URL).get("/place-types").set(as(ALICE_SUB));
    expect(res.status).toBe(200);
    const byId = new Map<string, Record<string, unknown>>(
      res.body.types.map((t: { id: string }) => [t.id, t]),
    );
    for (const type of SYSTEM_PLACE_TYPES) {
      const row = byId.get(type.id);
      expect(row, `system type ${type.name} is missing`).toBeTruthy();
      expect(row!.isSystem).toBe(true);
      expect(row!.ownerId).toBeNull();
    }
  });

  // The clients hide a type with zero places from the tab bar and the layers
  // panel, and refuse to delete one that has any — both need this number, and
  // asking per type would be a query each.
  it("carries a place count per type", async () => {
    const res = await request(API_URL).get("/place-types").set(as(ALICE_SUB));
    const canyon = res.body.types.find(
      (t: { id: string }) => t.id === SYSTEM_PLACE_TYPE_IDS.canyon,
    );
    expect(typeof canyon.placeCount).toBe("number");
    expect(canyon.placeCount).toBeGreaterThan(0);
  });

  // System types are GLOBAL — one row shared by everyone, not a per-user copy.
  // That is what makes a shared or copied place of a system type resolve for
  // its recipient with no reconciliation at all.
  it("gives every user the SAME system type rows", async () => {
    const [mine, theirs] = await Promise.all([
      request(API_URL).get("/place-types").set(as(ALICE_SUB)),
      request(API_URL).get("/place-types").set(as(BOB_SUB)),
    ]);
    const systemIds = (body: { types: { id: string; isSystem: boolean }[] }) =>
      body.types.filter((t) => t.isSystem).map((t) => t.id).sort();
    expect(systemIds(mine.body)).toEqual(systemIds(theirs.body));
  });
});

// §7.7 — system types and definitions are UNDELETABLE. Not a nicety: RopeWiki
// import writes reserved field keys into the Canyon type, so a deletable Canyon
// type would let import write values nothing can render.
describe("system types and definitions cannot be removed", () => {
  it("refuses to delete a system type", async () => {
    for (const id of Object.values(SYSTEM_PLACE_TYPE_IDS)) {
      const res = await request(API_URL).delete(`/place-types/${id}`).set(as(ALICE_SUB));
      expect([403, 404], `deleting ${id} answered ${res.status}`).toContain(res.status);
    }
    // Still there afterwards.
    const after = await request(API_URL).get("/place-types").set(as(ALICE_SUB));
    const ids = after.body.types.map((t: { id: string }) => t.id);
    for (const id of Object.values(SYSTEM_PLACE_TYPE_IDS)) {
      expect(ids).toContain(id);
    }
  });

  it("refuses to edit a system type", async () => {
    const res = await request(API_URL)
        .patch(`/place-types/${SYSTEM_PLACE_TYPE_IDS.canyon}`)
      .set(as(ALICE_SUB))
      .send({ name: "Mine now" });
    await afterWrite(res);
    expect(res.status).toBe(404);
  });

  it("refuses to delete a system field definition", async () => {
    const res = await request(API_URL)
        .delete("/custom-fields/place/v_grade")
      .set(as(ALICE_SUB));
    await afterWrite(res);
    expect(res.status).toBe(404);
    // And it still labels values.
    const fields = await request(API_URL).get("/custom-fields/place").set(as(ALICE_SUB));
    expect(fields.body.fields.map((f: { key: string }) => f.key)).toContain("v_grade");
  });

  // The other half of §7.7: RopeWiki import writes keys that EXIST. A key it
  // writes with no definition behind it is a value no form renders and no
  // filter finds.
  it("has a definition for every key RopeWiki writes", async () => {
    const res = await request(API_URL).get("/custom-fields/place").set(as(ALICE_SUB));
    const keys = new Set(res.body.fields.map((f: { key: string }) => f.key));
    for (const key of ["v_grade", "a_grade", "commitment", "quality", "hours", "num_abseils", "longest_abseil"]) {
      expect(keys.has(key), `no definition for ${key}`).toBe(true);
    }
  });
});

// §7.6 — a user field whose label slugs to a reserved key is REFUSED, with a
// suggestion. "V grade" on someone's own Campsite type slugs to `v_grade`,
// which is the key RopeWiki import writes into Canyon: two writers, one key.
describe("reserved keys are refused", () => {
  it("refuses a create whose key is reserved, and says what to do", async () => {
    const res = await request(API_URL)
        .post("/custom-fields/place")
      .set(as(ALICE_SUB))
      .send({ field: { key: "v_grade", label: "V grade", type: "integer" } });
    await afterWrite(res);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/reserved/i);
    // A bare "that key is taken" leaves the user renaming by trial and error.
    expect(res.body.error).toMatch(/try/i);
  });

  it("refuses every reserved key, not just the memorable ones", async () => {
    for (const def of SYSTEM_FIELD_DEFS) {
      const res = await request(API_URL)
          .post("/custom-fields/place")
        .set(as(ALICE_SUB))
        .send({ field: { key: def.key, label: def.label, type: "string" } });
    await afterWrite(res);
      expect(res.status, `${def.key} was accepted`).toBe(409);
    }
  });

  it("refuses a RENAME onto a reserved label", async () => {
    const create = await request(API_URL)
        .post("/custom-fields/place")
      .set(as(ALICE_SUB))
      .send({ field: { key: "rope_notes", label: "Rope notes", type: "string" } });
    await afterWrite(create);
    expect(create.status).toBe(201);
    createdFields.push("rope_notes");

    // The KEY never moves on a rename — every stored value is keyed by it — so
    // this is not a data collision. It is two fields displaying the same name,
    // one of them the built-in, which is worse than useless on a form.
    const rename = await request(API_URL)
        .patch("/custom-fields/place/rope_notes")
      .set(as(ALICE_SUB))
      .send({ label: "V grade" });
    await afterWrite(rename);
    expect(rename.status).toBe(409);
  });

  it("allows an ordinary label", async () => {
    const res = await request(API_URL)
        .post("/custom-fields/place")
      .set(as(ALICE_SUB))
      .send({ field: { key: "water_level", label: "Water level", type: "string" } });
    await afterWrite(res);
    expect(res.status).toBe(201);
    createdFields.push("water_level");
  });
});

// §7.4 — `appliesToAllTypes` is a FLAG, not join rows for the types that exist
// today. Join rows would silently fail to apply to a type created tomorrow, and
// the user who ticked "All" would never find out.
describe("appliesToAllTypes", () => {
  it("is inherited by a type created AFTER the definition", async () => {
    const key = `all_types_${Date.now()}`;
    const create = await request(API_URL)
        .post("/custom-fields/place")
      .set(as(ALICE_SUB))
      .send({
        field: { key, label: "Permit number", type: "string" },
        appliesToAllTypes: true,
      });
    await afterWrite(create);
    expect(create.status).toBe(201);
    createdFields.push(key);

    // The type does not exist yet — that is the whole point.
    const typeId = await makeType(ALICE_SUB, `Later type ${Date.now()}`);

    // A place of the NEW type validates a value under the OLD definition,
    // which it could only do if the definition applies to it.
    const place = await request(API_URL)
        .post("/places")
      .set(as(ALICE_SUB))
      .send({
        name: "Inherits the all-types field",
        latitude: -33.5,
        longitude: 150.3,
        placeTypeId: typeId,
        fieldValues: { [key]: "NPWS-1" },
      });
    await afterWrite(place);
    expect(place.status, JSON.stringify(place.body)).toBe(201);
    expect(place.body.fieldValues[key]).toBe("NPWS-1");
    await request(API_URL).delete(`/places/${place.body.id}`).set(as(ALICE_SUB));
  });

  it("does not make a type-scoped definition apply everywhere", async () => {
    const key = `scoped_${Date.now()}`;
    const typeId = await makeType(ALICE_SUB, `Scoped type ${Date.now()}`);
    const create = await request(API_URL)
        .post("/custom-fields/place")
      .set(as(ALICE_SUB))
      .send({
        field: { key, label: "Scoped field", type: "integer", min: 1, max: 5 },
        placeTypeIds: [typeId],
      });
    await afterWrite(create);
    expect(create.status).toBe(201);
    createdFields.push(key);

    // Out of range for the definition — refused on the type it IS scoped to...
    const scoped = await request(API_URL)
        .post("/places")
      .set(as(ALICE_SUB))
      .send({
        name: "Scoped",
        latitude: -33.5,
        longitude: 150.3,
        placeTypeId: typeId,
        fieldValues: { [key]: 99 },
      });
    await afterWrite(scoped);
    expect(scoped.status).toBe(400);

    // ...and NOT enforced on a type it is not scoped to, where the same key is
    // just an unrecognised value. Values outlive the definitions that describe
    // them (the trip-log union rule depends on exactly this), so an unknown key
    // is stored rather than rejected.
    const elsewhere = await request(API_URL)
        .post("/places")
      .set(as(ALICE_SUB))
      .send({
        name: "Elsewhere",
        latitude: -33.5,
        longitude: 150.3,
        placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker,
        fieldValues: { [key]: 99 },
      });
    await afterWrite(elsewhere);
    expect(elsewhere.status, JSON.stringify(elsewhere.body)).toBe(201);
    await request(API_URL).delete(`/places/${elsewhere.body.id}`).set(as(ALICE_SUB));
  });
});

describe("place type lifecycle", () => {
  it("refuses a second type with the same name", async () => {
    const name = `Duplicate ${Date.now()}`;
    await makeType(ALICE_SUB, name);
    const again = await request(API_URL)
        .post("/place-types")
      .set(as(ALICE_SUB))
      .send({ name, iconKey: "map-pin", color: "#22C55E" });
    await afterWrite(again);
    // Copy reconciliation matches an incoming type BY NAME, so two types with
    // one name would make that match ambiguous.
    expect(again.status).toBe(409);
  });

  it("lets two DIFFERENT users each have a type of the same name", async () => {
    const name = `Shared name ${Date.now()}`;
    await makeType(ALICE_SUB, name);
    const bobs = await request(API_URL)
        .post("/place-types")
      .set(as(BOB_SUB))
      .send({ name, iconKey: "map-pin", color: "#22C55E" });
    await afterWrite(bobs);
    expect(bobs.status).toBe(201);
    created.push(bobs.body.id);
  });

  it("refuses an icon or colour that is not in the curated set", async () => {
    const badIcon = await request(API_URL)
        .post("/place-types")
      .set(as(ALICE_SUB))
      .send({ name: `Bad icon ${Date.now()}`, iconKey: "waves", color: "#22C55E" });
    await afterWrite(badIcon);
    expect(badIcon.status).toBe(400);

    const badColor = await request(API_URL)
        .post("/place-types")
      .set(as(ALICE_SUB))
      .send({ name: `Bad colour ${Date.now()}`, iconKey: "map-pin", color: "#123456" });
    await afterWrite(badColor);
    expect(badColor.status).toBe(400);
  });

  // A type is a CATEGORY. Deleting one must never delete what is in it, so the
  // delete is refused with the count and the caller offers a reassign.
  it("refuses to delete a type that still holds places, then allows it after a reassign", async () => {
    const typeId = await makeType(ALICE_SUB, `Occupied ${Date.now()}`);
    const place = await request(API_URL)
        .post("/places")
      .set(as(ALICE_SUB))
      .send({
        name: "In the way",
        latitude: -33.5,
        longitude: 150.3,
        placeTypeId: typeId,
      });
    await afterWrite(place);
    expect(place.status).toBe(201);

    const blocked = await request(API_URL)
        .delete(`/place-types/${typeId}`)
      .set(as(ALICE_SUB));
    await afterWrite(blocked);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/1 place/);

    const moved = await request(API_URL)
        .post(`/place-types/${typeId}/reassign`)
      .set(as(ALICE_SUB))
      .send({ placeTypeId: SYSTEM_PLACE_TYPE_IDS.marker });
    await afterWrite(moved);
    expect(moved.status).toBe(200);
    expect(moved.body.movedCount).toBe(1);

    const gone = await request(API_URL).delete(`/place-types/${typeId}`).set(as(ALICE_SUB));
    expect(gone.status).toBe(200);

    // The place survived the delete of its old type, which is the point.
    const survivor = await request(API_URL)
      .get(`/places/${place.body.id}`)
      .set(as(ALICE_SUB));
    expect(survivor.status).toBe(200);
    expect(survivor.body.placeTypeId).toBe(SYSTEM_PLACE_TYPE_IDS.marker);
    await request(API_URL).delete(`/places/${place.body.id}`).set(as(ALICE_SUB));
  });

  // 404, not 403: an id the caller does not own must not be confirmed to exist.
  it("gives a foreign type the same 404 a nonexistent one gets", async () => {
    const bobsType = await request(API_URL)
        .post("/place-types")
      .set(as(BOB_SUB))
      .send({ name: `Bobs ${Date.now()}`, iconKey: "map-pin", color: "#22C55E" });
    await afterWrite(bobsType);
    expect(bobsType.status).toBe(201);
    created.push(bobsType.body.id);

    const patched = await request(API_URL)
        .patch(`/place-types/${bobsType.body.id}`)
      .set(as(ALICE_SUB))
      .send({ name: "Mine now" });
    await afterWrite(patched);
    expect(patched.status).toBe(404);
  });

  // A place must have a type. Defaulting silently to Canyon would file a
  // campsite the client forgot to type under canyons, where the user would
  // never think to look for it — and the request would look like it worked.
  it("refuses a place with no type, and one naming a foreign type", async () => {
    const none = await request(API_URL)
        .post("/places")
      .set(as(ALICE_SUB))
      // No placeTypeId AT ALL — that is the whole assertion.
      .send({ name: "Typeless", latitude: -33.5, longitude: 150.3 });
    await afterWrite(none);
    expect(none.status).toBe(400);

    const bobsType = await request(API_URL)
        .post("/place-types")
      .set(as(BOB_SUB))
      .send({ name: `Bobs other ${Date.now()}`, iconKey: "map-pin", color: "#22C55E" });
    await afterWrite(bobsType);
    created.push(bobsType.body.id);

    const foreign = await request(API_URL)
        .post("/places")
      .set(as(ALICE_SUB))
      .send({
        name: "Someone else's type",
        latitude: -33.5,
        longitude: 150.3,
        placeTypeId: bobsType.body.id,
      });
    await afterWrite(foreign);
    expect(foreign.status).toBe(400);
  });
});
