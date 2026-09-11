import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { PLACE_TYPE_COLORS } from "@logjam/shared";

import { API_URL } from "./_actors";
import { throttleWrites } from "./_rateLimitGate";

// This file WRITES — definitions, a place type, the legacy-PATCH refusals — and
// `userPatchLimiter` (30/60s, per user) is a second, tighter limiter than the
// global one `_rateLimitGate` handles. Its budget is shared with whichever
// write-heavy file ran before this one, so a 429 here arrives as an assertion
// failure about custom fields. `write()` sleeps to the window reset and retries
// instead; a sleep is up to ~61s, hence the timeout.
// `hookTimeout` too, not just `testTimeout`: teardown deletes are writes, they
// draw on the same 30/60s per-user budget, and vitest's 10s default for hooks
// is shorter than one window reset — so a suite that passed every assertion
// still failed, in the hook, with a message about nothing.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

/** A write that must succeed even if the previous file spent the budget. */
async function write<T extends { status: number; headers: Record<string, string> }>(
  send: () => Promise<T>,
): Promise<T> {
  const first = await send();
  return (await throttleWrites(first)) ? await send() : first;
}

// Requires `make dev`. No auth header = alice, who is seeded with three trip
// fields (water_level, rope_length_m, wetsuit) and no place fields.
//
// Definitions are ROWS in `custom_field_defs` now, not an array inside
// User.uiPreferences — so these tests cover the round trip that move created:
// the row-grain REST surface, the whole-list PATCH the web still uses, and the
// projection of both onto /users/me that keeps the web's response shape.
const AUTH = { Authorization: "Bearer fake-token" } as const;

/** Alice's current definitions for one entity, read back off /users/me. */
async function defsFromUser(key: "tripLogCustomFields" | "placeCustomFields") {
  const res = await request(API_URL).get("/users/me").set(AUTH);
  expect(res.status).toBe(200);
  return res.body.uiPreferences[key] as { key: string; label: string }[];
}

describe("custom-fields route (fake auth)", () => {
  it("404s impact for a field key the caller has not defined", async () => {
    const trip = await request(API_URL)
      .get("/custom-fields/trip-log/does-not-exist/impact")
      .set(AUTH);
    expect(trip.status).toBe(404);
    const place = await request(API_URL)
      .get("/custom-fields/place/does-not-exist/impact")
      .set(AUTH);
    expect(place.status).toBe(404);
  });

  it("404s delete for a field key the caller has not defined", async () => {
    const trip = await request(API_URL)
      .delete("/custom-fields/trip-log/does-not-exist")
      .set(AUTH);
    expect(trip.status).toBe(404);
    const place = await request(API_URL)
      .delete("/custom-fields/place/does-not-exist")
      .set(AUTH);
    expect(place.status).toBe(404);
  });

  it("404s an unknown entity segment", async () => {
    const res = await request(API_URL).get("/custom-fields/nonsense").set(AUTH);
    expect(res.status).toBe(404);
  });

  // The seed writes rows, not a preferences blob. If it ever goes back to the
  // blob, alice silently has no fields and every custom-field feature looks
  // broken for reasons that point somewhere else entirely.
  it("serves the seeded definitions, and /users/me projects the same list", async () => {
    const listed = await request(API_URL).get("/custom-fields/trip-log").set(AUTH);
    expect(listed.status).toBe(200);
    expect(listed.body.fields.map((f: { key: string }) => f.key)).toEqual([
      "water_level",
      "rope_length_m",
      "wetsuit",
    ]);
    // The /users/me projection is the PLAIN shape — key/label/type/bounds —
    // while the row-grain list carries the row's own metadata beside it: where
    // the definition appears, and whose it is. Same definitions, two reads, and
    // the projection is what the legacy readers still consume; comparing them
    // field-for-field would assert that nothing may ever be added to one of
    // them.
    const projected = await defsFromUser("tripLogCustomFields");
    expect(projected).toEqual(
      (listed.body.fields as Record<string, unknown>[]).map(
        ({ placeTypeIds: _s, appliesToAllTypes: _a, ownerId: _o, ...plain }) => plain,
      ),
    );
  });

  it("creates, relabels and deletes one definition, addressed by key", async () => {
    // Clean up a previous failed run so the suite is re-runnable.
    await write(() =>
      request(API_URL).delete("/custom-fields/place/permit_no").set(AUTH),
    );

    const created = await write(() =>
      request(API_URL)
        .post("/custom-fields/place")
        .set(AUTH)
        .send({ field: { key: "permit_no", label: "Permit no.", type: "string" } }),
    );
    expect(created.status).toBe(201);

    // A duplicate key is a 409, not a silent no-op — the label the user chose
    // is already taken and they have to see that.
    const dup = await write(() =>
      request(API_URL)
        .post("/custom-fields/place")
        .set(AUTH)
        .send({ field: { key: "permit_no", label: "Permit no.", type: "string" } }),
    );
    expect(dup.status).toBe(409);

    // A rename moves the label and keeps the key, so stored values stay
    // attached. `key` is not writable at all.
    const renamed = await write(() =>
      request(API_URL)
        .patch("/custom-fields/place/permit_no")
        .set(AUTH)
        .send({ label: "Permit number" }),
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.fields).toContainEqual(
      expect.objectContaining({
        key: "permit_no",
        label: "Permit number",
        type: "string",
        // Created with no scoping, so it applies to ALL types. This used to
        // assert the opposite — "applies to no type, visible and fixable" —
        // which was neither: a definition on no form is invisible everywhere
        // except the settings list, and the same default made every trip-log
        // field disappear (see the unscoped-definition test above).
        placeTypeIds: [],
        appliesToAllTypes: true,
      }),
    );

    // The rename is visible through the projection too — one source, two reads.
    expect(await defsFromUser("placeCustomFields")).toContainEqual({
      key: "permit_no",
      label: "Permit number",
      type: "string",
    });

    const removed = await write(() =>
      request(API_URL).delete("/custom-fields/place/permit_no").set(AUTH),
    );
    expect(removed.status).toBe(200);
    expect(removed.body.removedFromPlaceCount).toBe(0);
    // NOT `toEqual([])`: the list carries the SYSTEM definitions too, which
    // label the built-in fields and belong to no account. What has to be gone
    // is this user's own row.
    expect(
      (await defsFromUser("placeCustomFields")).map((def) => def.key),
    ).not.toContain("permit_no");
  });

  it("rejects a definition that is not valid", async () => {
    const res = await write(() =>
      request(API_URL)
        .post("/custom-fields/trip-log")
        .set(AUTH)
        .send({ field: { key: "bad", label: "Bad", type: "nonsense" } }),
    );
    expect(res.status).toBe(400);
  });

  // Validating the RESULT rather than the patch: moving only `min` can still
  // produce an invalid definition.
  it("rejects a patch whose result would be invalid", async () => {
    const res = await write(() =>
      request(API_URL)
        .patch("/custom-fields/trip-log/rope_length_m")
        .set(AUTH)
        .send({ min: 50, max: 10 }),
    );
    expect(res.status).toBe(400);
  });

  // THE WHOLE-LIST WRITE PATH IS GONE, and its removal is the assertion now.
  //
  // `PATCH /users/me { placeCustomFields: [...] }` reconciled a whole list of
  // `{key,label,type,min,max}`. That shape cannot express what a definition is
  // any more: it carries no `placeTypeIds` and no `appliesToAllTypes`, so every
  // save from a dialog that round-tripped the list would have wiped the scoping
  // off every definition — silently, because the payload simply did not mention
  // it. And it matched `existing` scoped to the caller, so the SYSTEM
  // definitions fell through to the create branch and the user acquired a
  // private duplicate of every built-in field, colliding under the same key.
  //
  // A client still sending it gets a 400 naming the replacement rather than a
  // silent no-op, which is the difference between a migration and a trap.
  it("refuses the legacy whole-list write and says what to use instead", async () => {
    for (const key of ["placeCustomFields", "tripLogCustomFields"]) {
      const res = await write(() =>
        request(API_URL)
          .patch("/users/me")
          .set(AUTH)
          .send({ [key]: [{ key: "access", label: "Access", type: "string" }] }),
      );
      expect(res.status, key).toBe(400);
      expect(res.body.error).toContain("/custom-fields/");
    }
  });

  // WHERE a definition appears has to reach the clients, or they hold every
  // definition and cannot tell which form any of them belongs on — a campsite
  // rendering seven canyon grades. `CustomFieldDefPlaceType` is not a sync
  // entity of its own, so the scoping rides ON the definition: flattened onto
  // the REST list, and onto the delta row.
  // THE INVISIBLE DEFINITION. A row with the flag off and no place types
  // scoped to it is on no form at all — both readers ask "all types, or one of
  // these?" — so it lists in Settings and appears nowhere else, which reads as
  // the save having failed. Every trip-log definition was in that state until
  // 20260911140000, alice's three seeded ones included.
  it("puts a definition that names no place types on every form", async () => {
    const key = `unscoped_${Date.now()}`.slice(0, 20);
    const created = await write(() =>
      request(API_URL)
        .post("/custom-fields/trip-log")
        .set(AUTH)
        .send({ field: { key, label: "Unscoped field", type: "string" } }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const list = await request(API_URL).get("/custom-fields/trip-log").set(AUTH);
    const def = (list.body.fields as Record<string, unknown>[]).find(
      (f) => f.key === key,
    );
    expect(def, "the definition should be listed").toBeTruthy();
    expect(def!.appliesToAllTypes).toBe(true);
    expect(def!.placeTypeIds).toEqual([]);

    // And the seeded three, which is where this was found.
    for (const seeded of ["water_level", "rope_length_m", "wetsuit"]) {
      const row = (list.body.fields as Record<string, unknown>[]).find(
        (f) => f.key === seeded,
      );
      expect(row, `${seeded} should be listed`).toBeTruthy();
      expect(
        row!.appliesToAllTypes,
        `${seeded} is on no form unless it applies to all types`,
      ).toBe(true);
    }

    await write(() =>
      request(API_URL).delete(`/custom-fields/trip-log/${key}`).set(AUTH),
    );
  });

  it("carries each definition's scoping on the REST list", async () => {
    const type = await write(() =>
      request(API_URL)
        .post("/place-types")
        .set(AUTH)
        .send({ name: `Scoped ${Date.now()}`, iconKey: "map-pin", color: PLACE_TYPE_COLORS[1] }),
    );
    expect(type.status, JSON.stringify(type.body)).toBe(201);
    const typeId = type.body.id as string;
    const key = `scoped_${Date.now()}`.slice(0, 20);

    const created = await write(() =>
      request(API_URL)
        .post("/custom-fields/place")
        .set(AUTH)
        .send({
          field: { key, label: "Scoped field", type: "string" },
          placeTypeIds: [typeId],
        }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const list = await request(API_URL).get("/custom-fields/place").set(AUTH);
    const def = (list.body.fields as Record<string, unknown>[]).find(
      (f) => f.key === key,
    );
    expect(def, "the definition should be listed").toBeTruthy();
    expect(def!.placeTypeIds).toEqual([typeId]);
    expect(def!.appliesToAllTypes).toBe(false);

    // A SYSTEM definition is scoped too — the seven grades belong to Canyon,
    // and a client that thought they applied to everything would put a V grade
    // on a campsite.
    const vGrade = (list.body.fields as Record<string, unknown>[]).find(
      (f) => f.key === "v_grade",
    );
    expect(vGrade, "the system definitions are in this list").toBeTruthy();
    expect(Array.isArray(vGrade!.placeTypeIds)).toBe(true);

    const delta = await request(API_URL)
      .get("/sync/delta")
      .set({ ...AUTH, "x-logjam-client": "mobile/0.1.0-test" })
      .query({ limit: 500 });
    expect(delta.status).toBe(200);
    const row = (delta.body.changes.customFieldDefs as Record<string, unknown>[]).find(
      (f) => f.key === key,
    );
    expect(row, "the delta should carry the definition").toBeTruthy();
    expect(row!.placeTypeIds).toEqual([typeId]);
    expect(row!.appliesToAllTypes).toBe(false);

    await write(() =>
      request(API_URL).delete(`/custom-fields/place/${key}`).set(AUTH),
    );
    await write(() => request(API_URL).delete(`/place-types/${typeId}`).set(AUTH));
  });
});
