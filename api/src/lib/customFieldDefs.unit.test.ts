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

import { createFieldDef, placeCustomFieldsRecord } from "./customFieldDefs";
import prisma from "../services/prisma";
import { tripLogHasCustomFieldValue } from "@logjam/shared";

// Each entity has ONE kind of scoping. A write that fills the other list is
// refused before anything is stored — a scoping the server silently dropped
// would leave the field on forms the user never chose, or on none.
describe("createFieldDef scoping", () => {
  const def = { key: "flow", label: "Flow", type: "integer" as const };

  it("refuses place types on a trip attribute", async () => {
    await expect(
      createFieldDef("user-1", "tripLog", { def, position: 0, placeTypeIds: ["type-1"] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.customFieldDef.create).not.toHaveBeenCalled();
  });

  it("refuses trip types on a place attribute", async () => {
    await expect(
      createFieldDef("user-1", "place", { def, position: 0, tripTypes: ["packrafting"] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.customFieldDef.create).not.toHaveBeenCalled();
  });

  // A trip attribute that names trip types is NOT on every form — the default
  // "all" is for a definition that names nothing.
  it("stores a trip attribute's trip types and leaves 'all' off", async () => {
    vi.mocked(prisma.customFieldDef.create).mockResolvedValueOnce({} as never);
    await createFieldDef("user-1", "tripLog", { def, position: 0, tripTypes: ["packrafting"] });
    expect(prisma.customFieldDef.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tripTypes: ["packrafting"],
        appliesToAllTypes: false,
      }),
    });
  });

  it("puts a trip attribute that names no trip types on every trip", async () => {
    vi.mocked(prisma.customFieldDef.create).mockResolvedValueOnce({} as never);
    await createFieldDef("user-1", "tripLog", { def, position: 0 });
    expect(prisma.customFieldDef.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ tripTypes: [], appliesToAllTypes: true }),
    });
  });
});

describe("placeCustomFieldsRecord", () => {
  // Values are at the TOP LEVEL of fieldValues now. They used to be nested
  // under `attributes.customFields`, and the forward migration hoists them —
  // reading the old shape here would find nothing on a migrated row, silently,
  // which is precisely the failure the hoist exists to prevent.
  it("reads the values at the top level", () => {
    expect(placeCustomFieldsRecord({ water_level: "high" })).toEqual({
      water_level: "high",
    });
  });

  it("returns null when fieldValues is not an object", () => {
    expect(placeCustomFieldsRecord(null)).toBeNull();
    expect(placeCustomFieldsRecord("nope")).toBeNull();
    expect(placeCustomFieldsRecord(42)).toBeNull();
    expect(placeCustomFieldsRecord([1, 2])).toBeNull();
  });

  it("returns null when there are no user fields", () => {
    expect(placeCustomFieldsRecord({})).toBeNull();
  });

  // The internal `_`-prefixed entries are not fields, and a delete must not
  // offer to strip the source list off every place the user owns.
  it("ignores the internal `_` namespace", () => {
    expect(
      placeCustomFieldsRecord({ _sources: [["Wiki", "http://x"]] }),
    ).toBeNull();
    // Not a key the code knows by name: the filter is the `_` prefix.
    expect(placeCustomFieldsRecord({ _legacy: { note: "kept" } })).toBeNull();
    expect(
      placeCustomFieldsRecord({ _sources: [], water_level: "high" }),
    ).toEqual({ water_level: "high" });
  });

  // The nested shape is what a PRE-migration row looks like. If one ever
  // reaches this reader, `customFields` is just another key — it must not be
  // unwrapped, or a half-migrated database would report values under a field
  // literally named "customFields".
  it("does not unwrap a legacy nested blob", () => {
    expect(
      placeCustomFieldsRecord({ customFields: { water_level: "high" } }),
    ).toEqual({ customFields: { water_level: "high" } });
  });
});

// The place impact predicate composes the extractor with the shared
// value-presence check (same semantics as trip logs: present, non-null,
// non-empty-string counts).
describe("place impact predicate", () => {
  function placeHasValue(fieldValues: unknown, key: string): boolean {
    const fields = placeCustomFieldsRecord(fieldValues as never);
    return fields ? tripLogHasCustomFieldValue(fields, key) : false;
  }

  it("counts a meaningful value", () => {
    expect(placeHasValue({ rope_m: 30 }, "rope_m")).toBe(true);
    expect(placeHasValue({ flag: false }, "flag")).toBe(true);
    expect(placeHasValue({ n: 0 }, "n")).toBe(true);
  });

  it("ignores absent / null / empty-string values", () => {
    expect(placeHasValue({ rope_m: "" }, "rope_m")).toBe(false);
    expect(placeHasValue({ rope_m: null }, "rope_m")).toBe(false);
    expect(placeHasValue({}, "rope_m")).toBe(false);
    expect(placeHasValue({ _sources: [] }, "rope_m")).toBe(false);
    expect(placeHasValue(null, "rope_m")).toBe(false);
  });
});
