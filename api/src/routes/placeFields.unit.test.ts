import { describe, it, expect, vi } from "vitest";

// The route module builds a Prisma client at import time; the validator under
// test is pure, so the client is stubbed out entirely.
vi.mock("../services/prisma", () => ({
  default: { place: { findMany: vi.fn(), count: vi.fn() } },
}));

import {
  validatePlaceTextFields,
  PLACE_NAME_MAX_LENGTH,
  PLACE_MAX_ALT_NAMES,
  placePayloadRefusal,
} from "./places";
import { PLACE_FIELDS } from "./sync";

// `validatePlacePayload` (shared) covers coordinates + numerics only;
// without text field validation, a mistyped name/altNames/notes/attributes
// would pass validation and die inside Prisma as a raw 500. On POST /sync/push
// that is worse than an ugly status code: the per-op catch re-throws
// non-AppErrors, so ONE bad op 500s every flush of that batch until someone
// intervenes by hand.
describe("validatePlaceTextFields", () => {
  it("accepts a well-formed payload", () => {
    expect(
      validatePlaceTextFields({
        name: "Claustral",
        altNames: ["Claustral Canyon"],
        notes: "beta",
        attributes: { water: "cold" },
      }),
    ).toBeNull();
  });

  it("accepts a payload with every optional field absent (PATCH)", () => {
    expect(validatePlaceTextFields({})).toBeNull();
  });

  it("rejects a non-string name", () => {
    expect(validatePlaceTextFields({ name: 123 })?.devDetail).toMatch(
      /name must be a string/,
    );
  });

  it("rejects a blank name", () => {
    expect(validatePlaceTextFields({ name: "   " })?.message).toBe(
      "A place needs a name.",
    );
  });

  it("caps name length", () => {
    expect(
      validatePlaceTextFields({ name: "x".repeat(PLACE_NAME_MAX_LENGTH) }),
    ).toBeNull();
    expect(
      validatePlaceTextFields({ name: "x".repeat(PLACE_NAME_MAX_LENGTH + 1) })
        ?.message,
    ).toMatch(/can be up to/);
  });

  it("rejects altNames that is not an array of strings", () => {
    expect(validatePlaceTextFields({ altNames: "x" })?.devDetail).toMatch(
      /array of strings/,
    );
    expect(validatePlaceTextFields({ altNames: [1] })?.devDetail).toMatch(
      /array of strings/,
    );
  });

  it("caps altNames count and entry length", () => {
    expect(
      validatePlaceTextFields({
        altNames: new Array(PLACE_MAX_ALT_NAMES + 1).fill("a"),
      })?.message,
    ).toMatch(/up to/);
    expect(
      validatePlaceTextFields({
        altNames: ["x".repeat(PLACE_NAME_MAX_LENGTH + 1)],
      })?.message,
    ).toMatch(/up to/);
  });

  it("bounds gaugeId to letters and digits, and allows null", () => {
    expect(validatePlaceTextFields({ gaugeId: "210001" })).toBeNull();
    expect(validatePlaceTextFields({ gaugeId: null })).toBeNull();
    for (const bad of ["", "a b", "x".repeat(21), 5]) {
      expect(validatePlaceTextFields({ gaugeId: bad })?.devDetail).toMatch(
        /gaugeId/,
      );
    }
  });

  it("allows null notes/altNames/attributes but rejects wrong types", () => {
    expect(
      validatePlaceTextFields({
        notes: null,
        altNames: null,
        attributes: null,
      }),
    ).toBeNull();
    expect(validatePlaceTextFields({ notes: 5 })?.devDetail).toMatch(
      /notes must be a string/,
    );
    expect(validatePlaceTextFields({ attributes: [1, 2] })?.devDetail).toMatch(
      /attributes must be an object/,
    );
    expect(validatePlaceTextFields({ attributes: "x" })?.devDetail).toMatch(
      /attributes must be an object/,
    );
  });
});

// ── the push allowlist, and what must never be in it ────────────────────────
//
// `foreignFields` records what the SENDER's definitions said about
// values this owner has no definition for. It is written ONLY by copy and by a
// place-type change, and its absence from this allowlist is what enforces
// that: an unknown key is a per-op 400, so a client cannot write it at all.
//
// Without this test that rule is a comment, which AGENTS.md forbids.
describe("PLACE_FIELDS (the push allowlist)", () => {
  it("does not admit foreignFields", () => {
    expect(
      PLACE_FIELDS.has("foreignFields"),
      "foreignFields is owner-provenance, not user input — a client that could " +
        "write it could forge where a value came from, or resurrect values the " +
        "owner discarded",
    ).toBe(false);
  });

  it("does not admit fieldDefsSnapshot either", () => {
    // Derived live from the OWNER's definitions on the way out. A client
    // writing it would be asserting what someone else's schema says.
    expect(PLACE_FIELDS.has("fieldDefsSnapshot")).toBe(false);
  });

  it("admits exactly the fields a user can edit", () => {
    expect([...PLACE_FIELDS].sort()).toEqual([
      "altNames",
      "elevation",
      "fieldValues",
      "gaugeId",
      "latitude",
      "longitude",
      "name",
      "notes",
      "placeTypeId",
    ]);
  });

  // The seven grade columns are gone from the wire entirely — a client still
  // sending `vGrade` gets a 400 rather than a silent drop, which is the
  // protocol's stated behaviour for an unknown key.
  it("no longer admits the grade columns", () => {
    for (const legacy of [
      "vGrade",
      "aGrade",
      "commitment",
      "quality",
      "hours",
      "numAbseils",
      "longestAbseil",
      "attributes",
    ]) {
      expect(PLACE_FIELDS.has(legacy), `${legacy} is still accepted`).toBe(
        false,
      );
    }
  });
});

// Privacy: a field's label is the user's own words about a place. The refusal
// shows it to its owner, quoted, and the developer detail (which is logged)
// never holds it. Mutation: return `malformed(error)` for every failure.
describe("placePayloadRefusal", () => {
  const defs = [
    { key: "depth", label: "Ranon slot depth", type: "integer", min: 0 },
  ];

  it("names the attribute that refused its value, and logs no label", () => {
    const refusal = placePayloadRefusal(
      { fieldValues: { depth: -1 } },
      { requireCoords: false, defs },
    );
    expect(refusal?.message).toBe(
      "The value for “Ranon slot depth” is outside what that attribute accepts.",
    );
    expect(refusal?.devDetail).toBeUndefined();
  });

  it("treats a bad coordinate as a broken request", () => {
    const refusal = placePayloadRefusal(
      { latitude: 999, fieldValues: { depth: -1 } },
      { requireCoords: false, defs },
    );
    expect(refusal?.devDetail).toMatch(/^Latitude/);
    expect(refusal?.devDetail).not.toMatch(/Ranon/);
  });

  it("passes a payload that is fine", () => {
    expect(
      placePayloadRefusal(
        { fieldValues: { depth: 3 } },
        { requireCoords: false, defs },
      ),
    ).toBeNull();
  });
});
