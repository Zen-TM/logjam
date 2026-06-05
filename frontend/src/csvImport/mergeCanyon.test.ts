import { describe, it, expect } from "vitest";
import { mergeCanyon } from "./mergeCanyon";
import type { TCanyon, BulkCanyonInput } from "../canyonUtils";

function existingCanyon(
  overrides: Partial<Omit<TCanyon, "attributes">> & {
    attributes?: Record<string, unknown>;
  } = {},
): TCanyon {
  return {
    id: "c1",
    name: "Existing Name",
    latitude: -33.5,
    longitude: 150.3,
    altNames: ["Old Alias"],
    vGrade: 3,
    aGrade: null,
    commitment: null,
    quality: null,
    wetsuits: null,
    numAbseils: null,
    longestAbseil: null,
    hours: null,
    notes: "existing notes",
    attributes: { terrain: "slot" },
    ...overrides,
  } as unknown as TCanyon;
}

describe("mergeCanyon", () => {
  it("keepExisting wins when both sides have a value", () => {
    const merged = mergeCanyon(
      existingCanyon(),
      { name: "x", latitude: 0, longitude: 0, vGrade: 5 } as BulkCanyonInput,
      "keepExisting",
    );
    expect(merged.vGrade).toBe(3);
  });

  it("useCsv wins when both sides have a value", () => {
    const merged = mergeCanyon(
      existingCanyon(),
      { name: "x", latitude: 0, longitude: 0, vGrade: 5 } as BulkCanyonInput,
      "useCsv",
    );
    expect(merged.vGrade).toBe(5);
  });

  it("fills an absent existing field from the CSV regardless of policy", () => {
    const merged = mergeCanyon(
      existingCanyon({ aGrade: null }),
      { name: "x", latitude: 0, longitude: 0, aGrade: 2 } as BulkCanyonInput,
      "keepExisting",
    );
    expect(merged.aGrade).toBe(2);
  });

  it("treats empty string and NaN as absent", () => {
    const merged = mergeCanyon(
      existingCanyon({ notes: "kept" }),
      { name: "x", latitude: 0, longitude: 0, notes: "" } as BulkCanyonInput,
      "useCsv",
    );
    expect(merged.notes).toBe("kept");
  });

  it("union-merges altNames with dedup", () => {
    const merged = mergeCanyon(
      existingCanyon({ altNames: ["Old Alias", "Shared"] }),
      { name: "x", latitude: 0, longitude: 0, altNames: ["Shared", "New Alias"] } as BulkCanyonInput,
      "keepExisting",
    );
    expect(merged.altNames).toEqual(["Old Alias", "Shared", "New Alias"]);
  });

  it("shallow-merges attributes per key with the policy", () => {
    const merged = mergeCanyon(
      existingCanyon({ attributes: { terrain: "slot", rock: "sandstone" } }),
      { name: "x", latitude: 0, longitude: 0, attributes: { terrain: "open", water: "high" } } as BulkCanyonInput,
      "useCsv",
    );
    expect(merged.attributes).toEqual({ terrain: "open", rock: "sandstone", water: "high" });
  });
});
