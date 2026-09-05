import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL } from "./_actors";

// Requires `make dev`. No auth header = alice, who is seeded with three trip
// fields (water_level, rope_length_m, wetsuit) and no canyon fields.
//
// Definitions are ROWS in `custom_field_defs` now, not an array inside
// User.uiPreferences — so these tests cover the round trip that move created:
// the row-grain REST surface, the whole-list PATCH the web still uses, and the
// projection of both onto /users/me that keeps the web's response shape.
const AUTH = { Authorization: "Bearer fake-token" } as const;

/** Alice's current definitions for one entity, read back off /users/me. */
async function defsFromUser(key: "tripLogCustomFields" | "canyonCustomFields") {
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
    const canyon = await request(API_URL)
      .get("/custom-fields/canyon/does-not-exist/impact")
      .set(AUTH);
    expect(canyon.status).toBe(404);
  });

  it("404s delete for a field key the caller has not defined", async () => {
    const trip = await request(API_URL)
      .delete("/custom-fields/trip-log/does-not-exist")
      .set(AUTH);
    expect(trip.status).toBe(404);
    const canyon = await request(API_URL)
      .delete("/custom-fields/canyon/does-not-exist")
      .set(AUTH);
    expect(canyon.status).toBe(404);
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
    expect(await defsFromUser("tripLogCustomFields")).toEqual(listed.body.fields);
  });

  it("creates, relabels and deletes one definition, addressed by key", async () => {
    // Clean up a previous failed run so the suite is re-runnable.
    await request(API_URL).delete("/custom-fields/canyon/permit_no").set(AUTH);

    const created = await request(API_URL)
      .post("/custom-fields/canyon")
      .set(AUTH)
      .send({ field: { key: "permit_no", label: "Permit no.", type: "string" } });
    expect(created.status).toBe(201);

    // A duplicate key is a 409, not a silent no-op — the label the user chose
    // is already taken and they have to see that.
    const dup = await request(API_URL)
      .post("/custom-fields/canyon")
      .set(AUTH)
      .send({ field: { key: "permit_no", label: "Permit no.", type: "string" } });
    expect(dup.status).toBe(409);

    // A rename moves the label and keeps the key, so stored values stay
    // attached. `key` is not writable at all.
    const renamed = await request(API_URL)
      .patch("/custom-fields/canyon/permit_no")
      .set(AUTH)
      .send({ label: "Permit number" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.fields).toContainEqual({
      key: "permit_no",
      label: "Permit number",
      type: "string",
    });

    // The rename is visible through the projection too — one source, two reads.
    expect(await defsFromUser("canyonCustomFields")).toContainEqual({
      key: "permit_no",
      label: "Permit number",
      type: "string",
    });

    const removed = await request(API_URL)
      .delete("/custom-fields/canyon/permit_no")
      .set(AUTH);
    expect(removed.status).toBe(200);
    expect(removed.body.removedFromCanyonCount).toBe(0);
    expect(await defsFromUser("canyonCustomFields")).toEqual([]);
  });

  it("rejects a definition that is not valid", async () => {
    const res = await request(API_URL)
      .post("/custom-fields/trip-log")
      .set(AUTH)
      .send({ field: { key: "bad", label: "Bad", type: "nonsense" } });
    expect(res.status).toBe(400);
  });

  // Validating the RESULT rather than the patch: moving only `min` can still
  // produce an invalid definition.
  it("rejects a patch whose result would be invalid", async () => {
    const res = await request(API_URL)
      .patch("/custom-fields/trip-log/rope_length_m")
      .set(AUTH)
      .send({ min: 50, max: 10 });
    expect(res.status).toBe(400);
  });

  // The web writes whole lists through PATCH /users/me; the reconcile behind it
  // must land as rows and come back through the projection unchanged.
  it("round-trips a whole-list write from the web's shape", async () => {
    const fields = [
      { key: "access", label: "Access", type: "string" },
      { key: "party", label: "Party size", type: "integer", min: 1, max: 12 },
    ];
    const patched = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ canyonCustomFields: fields });
    expect(patched.status).toBe(200);
    expect(patched.body.uiPreferences.canyonCustomFields).toEqual(fields);
    expect(await defsFromUser("canyonCustomFields")).toEqual(fields);

    // Dropping one from the list deletes its row (and would strip its values).
    const trimmed = await request(API_URL)
      .patch("/users/me")
      .set(AUTH)
      .send({ canyonCustomFields: [fields[0]] });
    expect(trimmed.status).toBe(200);
    expect(await defsFromUser("canyonCustomFields")).toEqual([fields[0]]);

    await request(API_URL).patch("/users/me").set(AUTH).send({ canyonCustomFields: [] });
    expect(await defsFromUser("canyonCustomFields")).toEqual([]);
  });
});
