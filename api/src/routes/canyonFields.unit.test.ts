import { describe, it, expect, vi } from "vitest";

// The route module builds a Prisma client at import time; the validator under
// test is pure, so the client is stubbed out entirely.
vi.mock("../services/prisma", () => ({
  default: { canyon: { findMany: vi.fn(), count: vi.fn() } },
}));

import {
  validateCanyonTextFields,
  CANYON_NAME_MAX_LENGTH,
  CANYON_MAX_ALT_NAMES,
} from "./canyons";

// APIR-010. `validateCanyonPayload` (shared) covers coordinates + numerics
// only, so a mistyped name/altNames/notes/attributes used to pass validation
// and die inside Prisma as a raw 500. On POST /sync/push that is worse than an
// ugly status code: the per-op catch re-throws non-AppErrors, so ONE bad op
// 500s every flush of that batch until someone intervenes by hand.
describe("validateCanyonTextFields", () => {
  it("accepts a well-formed payload", () => {
    expect(
      validateCanyonTextFields({
        name: "Claustral",
        altNames: ["Claustral Canyon"],
        notes: "beta",
        attributes: { water: "cold" },
      }),
    ).toBeNull();
  });

  it("accepts a payload with every optional field absent (PATCH)", () => {
    expect(validateCanyonTextFields({})).toBeNull();
  });

  it("rejects a non-string name", () => {
    expect(validateCanyonTextFields({ name: 123 })).toMatch(/name must be a string/);
  });

  it("rejects a blank name", () => {
    expect(validateCanyonTextFields({ name: "   " })).toMatch(/name is required/);
  });

  it("caps name length", () => {
    expect(validateCanyonTextFields({ name: "x".repeat(CANYON_NAME_MAX_LENGTH) })).toBeNull();
    expect(
      validateCanyonTextFields({ name: "x".repeat(CANYON_NAME_MAX_LENGTH + 1) }),
    ).toMatch(/at most/);
  });

  it("rejects altNames that is not an array of strings", () => {
    expect(validateCanyonTextFields({ altNames: "x" })).toMatch(/array of strings/);
    expect(validateCanyonTextFields({ altNames: [1] })).toMatch(/array of strings/);
  });

  it("caps altNames count and entry length", () => {
    expect(
      validateCanyonTextFields({ altNames: new Array(CANYON_MAX_ALT_NAMES + 1).fill("a") }),
    ).toMatch(/at most/);
    expect(
      validateCanyonTextFields({ altNames: ["x".repeat(CANYON_NAME_MAX_LENGTH + 1)] }),
    ).toMatch(/at most/);
  });

  it("allows null notes/altNames/attributes but rejects wrong types", () => {
    expect(validateCanyonTextFields({ notes: null, altNames: null, attributes: null })).toBeNull();
    expect(validateCanyonTextFields({ notes: 5 })).toMatch(/notes must be a string/);
    expect(validateCanyonTextFields({ attributes: [1, 2] })).toMatch(/attributes must be an object/);
    expect(validateCanyonTextFields({ attributes: "x" })).toMatch(/attributes must be an object/);
  });
});
