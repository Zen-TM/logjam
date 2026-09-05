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
