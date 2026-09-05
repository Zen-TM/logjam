import { describe, it, expect } from "vitest";
import {
  mergePlace,
  defaultPlaceMergePolicy,
  mergeableFieldsForDefs,
  type PlaceMergePolicy,
  type ExistingPlaceForMerge,
} from "./mergePlace.js";

// The seven grade columns are field VALUES now, so the merge fixtures speak
// field keys. Every invariant below is the one the column-shaped version
// asserted — the vocabulary moved, the rules did not.
const DEFS = [
  { key: "v_grade" },
  { key: "a_grade" },
  { key: "hours" },
  { key: "terrain" },
  { key: "water" },
];

function existingPlace(
  overrides: Partial<ExistingPlaceForMerge> = {},
): ExistingPlaceForMerge {
  return {
    name: "Existing Name",
    latitude: -33.5,
    longitude: 150.3,
    altNames: ["Old Alias"],
    notes: "existing notes",
    fieldValues: { v_grade: 3, terrain: "slot" },
    ...overrides,
  };
}

const KEEP: PlaceMergePolicy = defaultPlaceMergePolicy(
  mergeableFieldsForDefs(DEFS),
);
const USE_INCOMING: PlaceMergePolicy = Object.fromEntries(
  mergeableFieldsForDefs(DEFS).map((field) => [field, "useIncoming"]),
) as PlaceMergePolicy;

describe("mergeableFieldsForDefs", () => {
  it("is the definitions' keys plus the structural fields", () => {
    expect(mergeableFieldsForDefs([{ key: "capacity" }])).toEqual([
      "notes",
      "_attributes",
      "capacity",
    ]);
  });

  it("has no grade columns baked in — a type with no defs merges only notes", () => {
    expect(mergeableFieldsForDefs([])).toEqual(["notes", "_attributes"]);
  });
});

describe("mergePlace (shared, per-field policy)", () => {
  it("keeps name/lat/lng immutable from existing", () => {
    const merged = mergePlace(
      existingPlace(),
      { name: "Incoming", latitude: 0, longitude: 0 },
      USE_INCOMING,
    );
    expect(merged.name).toBe("Existing Name");
    expect(merged.latitude).toBe(-33.5);
    expect(merged.longitude).toBe(150.3);
  });

  it("keepExisting wins when both sides present", () => {
    const merged = mergePlace(
      existingPlace(),
      { fieldValues: { v_grade: 5 } },
      KEEP,
    );
    expect(merged.fieldValues.v_grade).toBe(3);
  });

  it("useIncoming wins when both sides present", () => {
    const merged = mergePlace(
      existingPlace(),
      { fieldValues: { v_grade: 5 } },
      USE_INCOMING,
    );
    expect(merged.fieldValues.v_grade).toBe(5);
  });

  it("per-field policy: one field keepExisting, another useIncoming", () => {
    const mixed: PlaceMergePolicy = { ...KEEP, hours: "useIncoming" };
    const merged = mergePlace(
      existingPlace({ fieldValues: { v_grade: 3, hours: 4 } }),
      { fieldValues: { v_grade: 5, hours: 6 } },
      mixed,
    );
    expect(merged.fieldValues.v_grade).toBe(3); // kept
    expect(merged.fieldValues.hours).toBe(6); // incoming
  });

  // A policy entry the user never set reads as keepExisting, which is the safe
  // direction. This is what lets a partial stored policy stay valid instead of
  // reverting every choice the moment the field list changes.
  it("treats a field missing from the policy as keepExisting", () => {
    const merged = mergePlace(
      existingPlace({ fieldValues: { v_grade: 3 } }),
      { fieldValues: { v_grade: 5 } },
      {},
    );
    expect(merged.fieldValues.v_grade).toBe(3);
  });

  it("fills an absent existing field from incoming regardless of policy", () => {
    const merged = mergePlace(
      existingPlace({ fieldValues: {} }),
      { fieldValues: { a_grade: 2 } },
      KEEP,
    );
    expect(merged.fieldValues.a_grade).toBe(2);
  });

  it("keeps existing when incoming field is absent", () => {
    const merged = mergePlace(existingPlace({ notes: "kept" }), {}, USE_INCOMING);
    expect(merged.notes).toBe("kept");
  });

  it("treats empty string and NaN as absent", () => {
    const merged = mergePlace(
      existingPlace({ notes: "kept" }),
      { notes: "" },
      USE_INCOMING,
    );
    expect(merged.notes).toBe("kept");
  });

  it("union-merges altNames with dedup", () => {
    const merged = mergePlace(
      existingPlace({ altNames: ["Old Alias", "Shared"] }),
      { altNames: ["Shared", "New Alias"] },
      KEEP,
    );
    expect(merged.altNames).toEqual(["Old Alias", "Shared", "New Alias"]);
  });

  it("always unions the source list regardless of policy", () => {
    const merged = mergePlace(
      existingPlace({ fieldValues: { _sources: [["OzUltimate", "http://oz"]] } }),
      { fieldValues: { _sources: [["RopeWiki", "http://rw"]] } },
      KEEP,
    );
    expect(merged.fieldValues._sources).toEqual([
      ["OzUltimate", "http://oz"],
      ["RopeWiki", "http://rw"],
    ]);
  });

  it("fills absent field keys from incoming (no data lost)", () => {
    const merged = mergePlace(
      existingPlace({ fieldValues: { terrain: "slot" } }),
      { fieldValues: { water: "high" } },
      KEEP,
    );
    expect(merged.fieldValues).toEqual({ terrain: "slot", water: "high" });
  });

  // A new key landed even before the field was a policy entry. Locked in on
  // both switch positions: the policy governs conflicts only, so it must not
  // gate a key the existing place has never seen.
  it("fills absent field keys from incoming under useIncoming too", () => {
    const merged = mergePlace(
      existingPlace({ fieldValues: { terrain: "slot" } }),
      { fieldValues: { water: "high" } },
      USE_INCOMING,
    );
    expect(merged.fieldValues).toEqual({ terrain: "slot", water: "high" });
  });

  it("keepExisting wins for a key present on both sides", () => {
    const merged = mergePlace(
      existingPlace({ fieldValues: { terrain: "slot" } }),
      { fieldValues: { terrain: "open" } },
      KEEP,
    );
    expect(merged.fieldValues.terrain).toBe("slot");
  });

  // The repair case: a corrected spreadsheet re-imported over a wrong value.
  it("useIncoming overwrites a key present on both sides", () => {
    const merged = mergePlace(
      existingPlace({ fieldValues: { terrain: "slot" } }),
      { fieldValues: { terrain: "open" } },
      { ...KEEP, terrain: "useIncoming" },
    );
    expect(merged.fieldValues.terrain).toBe("open");
  });

  it("each field's policy is independent of the others", () => {
    const merged = mergePlace(
      existingPlace({ fieldValues: { v_grade: 3, terrain: "slot" } }),
      { fieldValues: { v_grade: 5, terrain: "open" } },
      { ...USE_INCOMING, v_grade: "keepExisting" },
    );
    expect(merged.fieldValues.v_grade).toBe(3);
    expect(merged.fieldValues.terrain).toBe("open");
  });

  // Scoped out: clearing a value by blanking its cell is 23b's territory.
  // isPresent("") is false, so a blank cell reads as "column absent for this
  // row" and the existing value survives on BOTH switch positions. Asserted so
  // the boundary is visible rather than assumed.
  it("does not clear a value from a blank cell, even under useIncoming", () => {
    const merged = mergePlace(
      existingPlace({ fieldValues: { terrain: "slot" } }),
      { fieldValues: { terrain: "" } },
      USE_INCOMING,
    );
    expect(merged.fieldValues.terrain).toBe("slot");
  });

  it("never discards the source list when overwriting other keys", () => {
    const merged = mergePlace(
      existingPlace({
        fieldValues: {
          terrain: "slot",
          _sources: [["OzUltimate", "http://oz"]],
        },
      }),
      { fieldValues: { terrain: "open" } },
      USE_INCOMING,
    );
    expect(merged.fieldValues.terrain).toBe("open");
    expect(merged.fieldValues._sources).toEqual([["OzUltimate", "http://oz"]]);
  });

  // The legacy attributes bag moves as ONE unit under its own policy entry —
  // per-key policy there would mean a UI over a key set the user invents at
  // import time. Its per-key union rule still holds inside it.
  it("merges the legacy attributes bag per key under one policy entry", () => {
    const merged = mergePlace(
      existingPlace({
        fieldValues: { _attributes: { rockType: "sandstone", wetsuit: 3 } },
      }),
      { fieldValues: { _attributes: { rockType: "granite" } } },
      { ...KEEP, _attributes: "useIncoming" },
    );
    expect(merged.fieldValues._attributes).toEqual({
      rockType: "granite",
      wetsuit: 3,
    });
  });

  it("keeps the legacy bag's existing values under keepExisting", () => {
    const merged = mergePlace(
      existingPlace({ fieldValues: { _attributes: { rockType: "sandstone" } } }),
      { fieldValues: { _attributes: { rockType: "granite" } } },
      KEEP,
    );
    expect(merged.fieldValues._attributes).toEqual({ rockType: "sandstone" });
  });

  // An internal key must never be governed by the field policy of the same
  // name — `_sources` unions no matter what a policy says about it.
  it("ignores a policy entry that tries to govern the source list", () => {
    const merged = mergePlace(
      existingPlace({ fieldValues: { _sources: [["A", "http://a"]] } }),
      { fieldValues: { _sources: [["B", "http://b"]] } },
      { _sources: "useIncoming" } as PlaceMergePolicy,
    );
    expect(merged.fieldValues._sources).toEqual([
      ["A", "http://a"],
      ["B", "http://b"],
    ]);
  });
});
