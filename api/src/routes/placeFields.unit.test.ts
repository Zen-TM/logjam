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
} from "./places";
import { PLACE_FIELDS } from "./sync";

// APIR-010. `validatePlacePayload` (shared) covers coordinates + numerics
// only, so a mistyped name/altNames/notes/attributes used to pass validation
// and die inside Prisma as a raw 500. On POST /sync/push that is worse than an
// ugly status code: the per-op catch re-throws non-AppErrors, so ONE bad op
// 500s every flush of that batch until someone intervenes by hand.
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
    expect(validatePlaceTextFields({ name: 123 })).toMatch(/name must be a string/);
  });

  it("rejects a blank name", () => {
    expect(validatePlaceTextFields({ name: "   " })).toMatch(/name is required/);
  });

  it("caps name length", () => {
    expect(validatePlaceTextFields({ name: "x".repeat(PLACE_NAME_MAX_LENGTH) })).toBeNull();
    expect(
      validatePlaceTextFields({ name: "x".repeat(PLACE_NAME_MAX_LENGTH + 1) }),
    ).toMatch(/at most/);
  });

  it("rejects altNames that is not an array of strings", () => {
    expect(validatePlaceTextFields({ altNames: "x" })).toMatch(/array of strings/);
    expect(validatePlaceTextFields({ altNames: [1] })).toMatch(/array of strings/);
  });

  it("caps altNames count and entry length", () => {
    expect(
      validatePlaceTextFields({ altNames: new Array(PLACE_MAX_ALT_NAMES + 1).fill("a") }),
    ).toMatch(/at most/);
    expect(
      validatePlaceTextFields({ altNames: ["x".repeat(PLACE_NAME_MAX_LENGTH + 1)] }),
    ).toMatch(/at most/);
  });

  it("allows null notes/altNames/attributes but rejects wrong types", () => {
    expect(validatePlaceTextFields({ notes: null, altNames: null, attributes: null })).toBeNull();
    expect(validatePlaceTextFields({ notes: 5 })).toMatch(/notes must be a string/);
    expect(validatePlaceTextFields({ attributes: [1, 2] })).toMatch(/attributes must be an object/);
    expect(validatePlaceTextFields({ attributes: "x" })).toMatch(/attributes must be an object/);
  });
});

// ── the push allowlist, and what must never be in it ────────────────────────
//
// Plan §7.13. `foreignFields` records what the SENDER's definitions said about
// values this owner has no definition for. It is written ONLY by copy and by a
// place-type change, and its absence from this allowlist is what enforces
// that: an unknown key is a per-op 400, so a client cannot write it at all.
//
// Without this test that rule is a comment, which the root CLAUDE.md forbids.
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
      "latitude",
      "longitude",
      "name",
      "notes",
      "placeTypeId",
    ]);
  });

  // The seven grade columns are gone from the wire entirely — a client still
  // sending `vGrade` gets a 400 rather than a silent drop, which is the
  // protocol's stated behaviour for an unknown key (§10.4).
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
      expect(PLACE_FIELDS.has(legacy), `${legacy} is still accepted`).toBe(false);
    }
  });
});
