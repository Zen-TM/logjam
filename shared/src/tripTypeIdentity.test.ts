import { describe, expect, it } from "vitest";
import { ASSET_HUES, TRIP_TYPE_OPEN_HUES } from "./designTokens.js";
import {
  primaryTripType,
  TRIP_TYPE_ICON_KEYS,
  tripTypeIdentity,
  tripTypeLabel,
} from "./tripTypeIdentity.js";

describe("tripTypeIdentity", () => {
  it("gives canyoning the scheme accent, whatever its casing", () => {
    expect(tripTypeIdentity("canyoning")).toEqual({ icon: "droplet", hue: "accent" });
    expect(tripTypeIdentity("Canyoning")).toEqual({ icon: "droplet", hue: "accent" });
  });

  it("borrows the seeded activities' hues from the asset palette", () => {
    expect(tripTypeIdentity("bushwalking").hue).toBe(ASSET_HUES.overlay);
    expect(tripTypeIdentity("packrafting").hue).toBe(ASSET_HUES.import);
  });

  it("gives a trip with no type its own glyph and the untyped role", () => {
    expect(tripTypeIdentity(null)).toEqual({ icon: "book-open", hue: "untyped" });
    expect(tripTypeIdentity("")).toEqual({ icon: "book-open", hue: "untyped" });
  });

  it("hashes a user-typed type into the open palette, stably and case-blind", () => {
    const caving = tripTypeIdentity("vertical caving");
    expect(caving.icon).toBe("tag");
    expect(Object.values(TRIP_TYPE_OPEN_HUES)).toContain(caving.hue);
    expect(tripTypeIdentity("Vertical Caving")).toEqual(caving);
  });

  it("only ever answers with a declared glyph", () => {
    for (const type of [null, "canyoning", "bushwalking", "bikepacking", "packrafting", "anything"]) {
      expect(TRIP_TYPE_ICON_KEYS).toContain(tripTypeIdentity(type).icon);
    }
  });
});

describe("primaryTripType and tripTypeLabel", () => {
  it("represents a trip by its first type", () => {
    expect(primaryTripType(["abseil course", "canyoning"])).toBe("abseil course");
    expect(primaryTripType([])).toBeNull();
  });

  it("capitalises for display only", () => {
    expect(tripTypeLabel("canyoning")).toBe("Canyoning");
  });
});
