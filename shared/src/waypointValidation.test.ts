import { describe, expect, it } from "vitest";
import {
  MAX_CANYONS_PER_WAYPOINT,
  MAX_TAGS_PER_WAYPOINT,
  normalizeWaypointCanyonIds,
  normalizeWaypointTags,
  validateWaypointPayload,
  WAYPOINT_NAME_MAX_LENGTH,
  WAYPOINT_NOTES_MAX_LENGTH,
  WAYPOINT_SYMBOL_MAX_LENGTH,
  WAYPOINT_TAG_MAX_LENGTH,
} from "./waypointValidation";

// Synthetic coords only (committed-fixture rule): 150.2–150.3 E, −33.6–−33.7 S.
const valid = {
  name: "Anchor tree",
  latitude: -33.65,
  longitude: 150.25,
};

describe("validateWaypointPayload (create: requireCore)", () => {
  it("accepts a minimal valid payload", () => {
    expect(validateWaypointPayload(valid, { requireCore: true })).toBeNull();
  });

  it("accepts optional fields when valid", () => {
    expect(
      validateWaypointPayload(
        { ...valid, elevation: 850.5, symbol: "anchor", notes: "double bolt" },
        { requireCore: true },
      ),
    ).toBeNull();
  });

  it.each([
    [{ ...valid, name: undefined }, "name is required"],
    [{ ...valid, name: "   " }, "name is required"],
    [{ ...valid, name: 42 }, "name is required"],
    [
      { ...valid, name: "x".repeat(WAYPOINT_NAME_MAX_LENGTH + 1) },
      `name must be at most ${WAYPOINT_NAME_MAX_LENGTH} characters`,
    ],
  ])("rejects bad name %#", (payload, message) => {
    expect(validateWaypointPayload(payload, { requireCore: true })).toBe(message);
  });

  it.each([
    { ...valid, latitude: undefined },
    { ...valid, latitude: -91 },
    { ...valid, latitude: NaN },
    { ...valid, latitude: "33" },
  ])("rejects bad latitude %#", (payload) => {
    expect(validateWaypointPayload(payload, { requireCore: true })).toMatch(
      /^Latitude/,
    );
  });

  it.each([
    { ...valid, longitude: undefined },
    { ...valid, longitude: 181 },
    { ...valid, longitude: Infinity },
  ])("rejects bad longitude %#", (payload) => {
    expect(validateWaypointPayload(payload, { requireCore: true })).toMatch(
      /^Longitude/,
    );
  });

  it("rejects non-finite elevation", () => {
    expect(
      validateWaypointPayload({ ...valid, elevation: NaN }, { requireCore: true }),
    ).toBe("elevation must be a number");
    expect(
      validateWaypointPayload({ ...valid, elevation: "850" }, { requireCore: true }),
    ).toBe("elevation must be a number");
  });

  it("caps symbol and notes", () => {
    expect(
      validateWaypointPayload(
        { ...valid, symbol: "s".repeat(WAYPOINT_SYMBOL_MAX_LENGTH + 1) },
        { requireCore: true },
      ),
    ).toBe(`symbol must be at most ${WAYPOINT_SYMBOL_MAX_LENGTH} characters`);
    expect(
      validateWaypointPayload(
        { ...valid, notes: "n".repeat(WAYPOINT_NOTES_MAX_LENGTH + 1) },
        { requireCore: true },
      ),
    ).toBe(`notes must be at most ${WAYPOINT_NOTES_MAX_LENGTH} characters`);
  });
});

describe("validateWaypointPayload (patch: sparse)", () => {
  it("accepts an empty patch", () => {
    expect(validateWaypointPayload({}, { requireCore: false })).toBeNull();
  });

  it("accepts explicit null for clearable fields", () => {
    expect(
      validateWaypointPayload(
        { elevation: null, symbol: null, notes: null },
        { requireCore: false },
      ),
    ).toBeNull();
  });

  it("still validates supplied fields", () => {
    expect(
      validateWaypointPayload({ latitude: 95 }, { requireCore: false }),
    ).toMatch(/^Latitude/);
    expect(validateWaypointPayload({ name: "" }, { requireCore: false })).toBe(
      "name is required",
    );
  });
});

describe("normalizeWaypointTags", () => {
  it("distinguishes undefined (unchanged) from null (cleared)", () => {
    expect(normalizeWaypointTags(undefined)).toEqual({ tags: undefined });
    expect(normalizeWaypointTags(null)).toEqual({ tags: [] });
  });

  it("trims and preserves order", () => {
    expect(normalizeWaypointTags([" carpark ", "water"])).toEqual({
      tags: ["carpark", "water"],
    });
  });

  it("rejects case-insensitive duplicates", () => {
    expect(normalizeWaypointTags(["Carpark", "carpark"])).toEqual({
      error: "tags contains case-insensitive duplicates",
    });
  });

  it.each([
    [42, "tags must be an array of strings or null"],
    [[7], "tags must be an array of strings"],
    [["  "], "tags entries must not be empty"],
    [
      ["t".repeat(WAYPOINT_TAG_MAX_LENGTH + 1)],
      `tags entries must be at most ${WAYPOINT_TAG_MAX_LENGTH} characters`,
    ],
    [
      Array.from({ length: MAX_TAGS_PER_WAYPOINT + 1 }, (_, i) => `tag${i}`),
      `At most ${MAX_TAGS_PER_WAYPOINT} tags per waypoint`,
    ],
  ])("rejects bad tags %#", (value, error) => {
    expect(normalizeWaypointTags(value)).toEqual({ error });
  });

  it("is reached through validateWaypointPayload", () => {
    expect(
      validateWaypointPayload({ tags: ["a", "A"] }, { requireCore: false }),
    ).toBe("tags contains case-insensitive duplicates");
  });
});

describe("normalizeWaypointCanyonIds", () => {
  it("distinguishes undefined (unchanged) from null (unlink all)", () => {
    expect(normalizeWaypointCanyonIds(undefined)).toEqual({
      canyonIds: undefined,
    });
    expect(normalizeWaypointCanyonIds(null)).toEqual({ canyonIds: [] });
  });

  it("dedupes exactly, leaving authorization to the server", () => {
    expect(normalizeWaypointCanyonIds(["a", "a", "b"])).toEqual({
      canyonIds: ["a", "b"],
    });
  });

  it.each([
    [42, "canyonIds must be an array of strings or null"],
    [[7], "canyonIds must be an array of strings"],
    [
      Array.from({ length: MAX_CANYONS_PER_WAYPOINT + 1 }, (_, i) => `c${i}`),
      `At most ${MAX_CANYONS_PER_WAYPOINT} canyons per waypoint`,
    ],
  ])("rejects bad canyonIds %#", (value, error) => {
    expect(normalizeWaypointCanyonIds(value)).toEqual({ error });
  });
});
