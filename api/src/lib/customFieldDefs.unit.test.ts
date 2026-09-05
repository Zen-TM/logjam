import { describe, it, expect, vi } from "vitest";

// The store imports the Prisma singleton at load; mock it so importing the
// pure helpers under test doesn't require a DB connection.
vi.mock("../services/prisma", () => ({
  default: {
    tripLog: { findMany: vi.fn(), update: vi.fn() },
    place: { findMany: vi.fn(), update: vi.fn() },
    customFieldDef: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { placeCustomFieldsRecord } from "./customFieldDefs";
import { tripLogHasCustomFieldValue } from "@logjam/shared";

describe("placeCustomFieldsRecord", () => {
  it("extracts the nested customFields object", () => {
    expect(
      placeCustomFieldsRecord({ customFields: { water_level: "high" } }),
    ).toEqual({ water_level: "high" });
  });

  it("returns null when attributes is not an object", () => {
    expect(placeCustomFieldsRecord(null)).toBeNull();
    expect(placeCustomFieldsRecord("nope")).toBeNull();
    expect(placeCustomFieldsRecord(42)).toBeNull();
    expect(placeCustomFieldsRecord([1, 2])).toBeNull();
  });

  it("returns null when there are no custom fields (sources-only attributes)", () => {
    expect(placeCustomFieldsRecord({ sources: [["Wiki", "http://x"]] })).toBeNull();
  });

  it("returns null when customFields is present but not an object", () => {
    expect(placeCustomFieldsRecord({ customFields: "bad" })).toBeNull();
    expect(placeCustomFieldsRecord({ customFields: null })).toBeNull();
  });
});

// The place impact predicate composes the extractor with the shared
// value-presence check (same semantics as trip logs: present, non-null,
// non-empty-string counts).
describe("place impact predicate", () => {
  function placeHasValue(attributes: unknown, key: string): boolean {
    const fields = placeCustomFieldsRecord(attributes as never);
    return fields ? tripLogHasCustomFieldValue(fields, key) : false;
  }

  it("counts a meaningful value", () => {
    expect(placeHasValue({ customFields: { rope_m: 30 } }, "rope_m")).toBe(true);
    expect(placeHasValue({ customFields: { flag: false } }, "flag")).toBe(true);
    expect(placeHasValue({ customFields: { n: 0 } }, "n")).toBe(true);
  });

  it("ignores absent / null / empty-string values", () => {
    expect(placeHasValue({ customFields: { rope_m: "" } }, "rope_m")).toBe(false);
    expect(placeHasValue({ customFields: { rope_m: null } }, "rope_m")).toBe(false);
    expect(placeHasValue({ customFields: {} }, "rope_m")).toBe(false);
    expect(placeHasValue({ sources: [] }, "rope_m")).toBe(false);
    expect(placeHasValue(null, "rope_m")).toBe(false);
  });
});
