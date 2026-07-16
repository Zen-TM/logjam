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
  attributes: "useIncoming",
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

  // A new attribute key landed even before `attributes` joined the policy map.
  // Locked in on both switch positions: the policy governs conflicts only, so it
  // must not gate a key the existing canyon has never seen.
  it("fills absent attribute keys from incoming under useIncoming too", () => {
    const merged = mergeCanyon(
      existingCanyon({ attributes: { terrain: "slot" } }),
      { attributes: { water: "high" } },
      USE_INCOMING,
    );
    expect(merged.attributes).toEqual({ terrain: "slot", water: "high" });
  });

  it("keepExisting wins for an attribute key present on both sides", () => {
    const merged = mergeCanyon(
      existingCanyon({ attributes: { terrain: "slot" } }),
      { attributes: { terrain: "open" } },
      KEEP,
    );
    expect(merged.attributes.terrain).toBe("slot");
  });

  // The repair case: a corrected spreadsheet re-imported over a wrong value. This
  // was impossible before `attributes` was a policy entry — existing always won.
  it("useIncoming overwrites an attribute key present on both sides", () => {
    const merged = mergeCanyon(
      existingCanyon({ attributes: { terrain: "slot" } }),
      { attributes: { terrain: "open" } },
      { ...KEEP, attributes: "useIncoming" },
    );
    expect(merged.attributes.terrain).toBe("open");
  });

  it("attributes policy is independent of the scalar field policies", () => {
    const merged = mergeCanyon(
      existingCanyon({ vGrade: 3, attributes: { terrain: "slot" } }),
      { vGrade: 5, attributes: { terrain: "open" } },
      { ...USE_INCOMING, vGrade: "keepExisting" },
    );
    expect(merged.vGrade).toBe(3);
    expect(merged.attributes.terrain).toBe("open");
  });

  // Scoped out: clearing an attribute by blanking its cell is 23b's territory.
  // isPresent("") is false, so a blank cell reads as "column absent for this row"
  // and the existing value survives on BOTH switch positions. Asserted so the
  // boundary is visible rather than assumed.
  it("does not clear an attribute from a blank cell, even under useIncoming", () => {
    const merged = mergeCanyon(
      existingCanyon({ attributes: { terrain: "slot" } }),
      { attributes: { terrain: "" } },
      USE_INCOMING,
    );
    expect(merged.attributes.terrain).toBe("slot");
  });

  it("never discards attributes.sources when overwriting other keys", () => {
    const merged = mergeCanyon(
      existingCanyon({
        attributes: { terrain: "slot", sources: [["OzUltimate", "http://oz"]] },
      }),
      { attributes: { terrain: "open" } },
      USE_INCOMING,
    );
    expect(merged.attributes.terrain).toBe("open");
    expect(merged.attributes.sources).toEqual([["OzUltimate", "http://oz"]]);
  });
});
