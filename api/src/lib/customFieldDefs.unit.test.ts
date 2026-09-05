import { describe, it, expect, vi } from "vitest";

// The store imports the Prisma singleton at load; mock it so importing the
// pure helpers under test doesn't require a DB connection.
vi.mock("../services/prisma", () => ({
  default: {
    tripLog: { findMany: vi.fn(), update: vi.fn() },
    canyon: { findMany: vi.fn(), update: vi.fn() },
    customFieldDef: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { canyonCustomFieldsRecord } from "./customFieldDefs";
import { tripLogHasCustomFieldValue } from "@logjam/shared";

describe("canyonCustomFieldsRecord", () => {
  it("extracts the nested customFields object", () => {
    expect(
      canyonCustomFieldsRecord({ customFields: { water_level: "high" } }),
    ).toEqual({ water_level: "high" });
  });

  it("returns null when attributes is not an object", () => {
    expect(canyonCustomFieldsRecord(null)).toBeNull();
    expect(canyonCustomFieldsRecord("nope")).toBeNull();
    expect(canyonCustomFieldsRecord(42)).toBeNull();
    expect(canyonCustomFieldsRecord([1, 2])).toBeNull();
  });

  it("returns null when there are no custom fields (sources-only attributes)", () => {
    expect(canyonCustomFieldsRecord({ sources: [["Wiki", "http://x"]] })).toBeNull();
  });

  it("returns null when customFields is present but not an object", () => {
    expect(canyonCustomFieldsRecord({ customFields: "bad" })).toBeNull();
    expect(canyonCustomFieldsRecord({ customFields: null })).toBeNull();
  });
});

// The canyon impact predicate composes the extractor with the shared
// value-presence check (same semantics as trip logs: present, non-null,
// non-empty-string counts).
describe("canyon impact predicate", () => {
  function canyonHasValue(attributes: unknown, key: string): boolean {
    const fields = canyonCustomFieldsRecord(attributes as never);
    return fields ? tripLogHasCustomFieldValue(fields, key) : false;
  }

  it("counts a meaningful value", () => {
    expect(canyonHasValue({ customFields: { rope_m: 30 } }, "rope_m")).toBe(true);
    expect(canyonHasValue({ customFields: { flag: false } }, "flag")).toBe(true);
    expect(canyonHasValue({ customFields: { n: 0 } }, "n")).toBe(true);
  });

  it("ignores absent / null / empty-string values", () => {
    expect(canyonHasValue({ customFields: { rope_m: "" } }, "rope_m")).toBe(false);
    expect(canyonHasValue({ customFields: { rope_m: null } }, "rope_m")).toBe(false);
    expect(canyonHasValue({ customFields: {} }, "rope_m")).toBe(false);
    expect(canyonHasValue({ sources: [] }, "rope_m")).toBe(false);
    expect(canyonHasValue(null, "rope_m")).toBe(false);
  });
});
