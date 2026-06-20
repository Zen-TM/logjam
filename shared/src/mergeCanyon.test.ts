import { describe, it, expect } from "vitest";
import {
  mergeCanyon,
  DEFAULT_CANYON_MERGE_POLICY,
  type CanyonMergePolicy,
  type ExistingCanyonForMerge,
} from "./mergeCanyon.js";

function existingCanyon(
  overrides: Partial<ExistingCanyonForMerge> = {},
): ExistingCanyonForMerge {
  return {
    name: "Existing Name",
    latitude: -33.5,
    longitude: 150.3,
    altNames: ["Old Alias"],
    vGrade: 3,
    aGrade: null,
    commitment: null,
    quality: null,
    numAbseils: null,
    longestAbseil: null,
    hours: null,
    notes: "existing notes",
    attributes: { terrain: "slot" },
    ...overrides,
  };
}

const KEEP: CanyonMergePolicy = DEFAULT_CANYON_MERGE_POLICY;
const USE_INCOMING: CanyonMergePolicy = {
  vGrade: "useIncoming",
  aGrade: "useIncoming",
  commitment: "useIncoming",
  quality: "useIncoming",
  numAbseils: "useIncoming",
  longestAbseil: "useIncoming",
  hours: "useIncoming",
  notes: "useIncoming",
};

describe("mergeCanyon (shared, per-field policy)", () => {
  it("keeps name/lat/lng immutable from existing", () => {
    const merged = mergeCanyon(
      existingCanyon(),
      { name: "Incoming", latitude: 0, longitude: 0 },
      USE_INCOMING,
    );
    expect(merged.name).toBe("Existing Name");
    expect(merged.latitude).toBe(-33.5);
    expect(merged.longitude).toBe(150.3);
  });

  it("keepExisting wins when both sides present", () => {
    const merged = mergeCanyon(existingCanyon(), { vGrade: 5 }, KEEP);
    expect(merged.vGrade).toBe(3);
  });

  it("useIncoming wins when both sides present", () => {
    const merged = mergeCanyon(existingCanyon(), { vGrade: 5 }, USE_INCOMING);
    expect(merged.vGrade).toBe(5);
  });

  it("per-field policy: one field keepExisting, another useIncoming", () => {
    const mixed: CanyonMergePolicy = {
      ...KEEP,
      hours: "useIncoming",
    };
    const merged = mergeCanyon(
      existingCanyon({ vGrade: 3, hours: 4 }),
      { vGrade: 5, hours: 6 },
      mixed,
    );
    expect(merged.vGrade).toBe(3); // kept
    expect(merged.hours).toBe(6); // incoming
  });

  it("fills an absent existing field from incoming regardless of policy", () => {
    const merged = mergeCanyon(
      existingCanyon({ aGrade: null }),
      { aGrade: 2 },
      KEEP,
    );
    expect(merged.aGrade).toBe(2);
  });

  it("keeps existing when incoming field is absent", () => {
    const merged = mergeCanyon(existingCanyon({ notes: "kept" }), {}, USE_INCOMING);
    expect(merged.notes).toBe("kept");
  });

  it("treats empty string and NaN as absent", () => {
    const merged = mergeCanyon(
      existingCanyon({ notes: "kept" }),
      { notes: "" },
      USE_INCOMING,
    );
    expect(merged.notes).toBe("kept");
  });

  it("union-merges altNames with dedup", () => {
    const merged = mergeCanyon(
      existingCanyon({ altNames: ["Old Alias", "Shared"] }),
      { altNames: ["Shared", "New Alias"] },
      KEEP,
    );
    expect(merged.altNames).toEqual(["Old Alias", "Shared", "New Alias"]);
  });

  it("always unions attributes.sources regardless of policy", () => {
    const merged = mergeCanyon(
      existingCanyon({
        attributes: { sources: [["OzUltimate", "http://oz"]] },
      }),
      { attributes: { sources: [["RopeWiki", "http://rw"]] } },
      KEEP,
    );
    expect(merged.attributes.sources).toEqual([
      ["OzUltimate", "http://oz"],
      ["RopeWiki", "http://rw"],
    ]);
  });

  it("fills absent attribute keys from incoming (no data lost)", () => {
    const merged = mergeCanyon(
      existingCanyon({ attributes: { terrain: "slot" } }),
      { attributes: { water: "high" } },
      KEEP,
    );
    expect(merged.attributes).toEqual({ terrain: "slot", water: "high" });
  });
});
