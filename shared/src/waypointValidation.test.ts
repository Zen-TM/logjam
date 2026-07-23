import { describe, expect, it } from "vitest";
import {
  validateWaypointPayload,
  WAYPOINT_NAME_MAX_LENGTH,
  WAYPOINT_NOTES_MAX_LENGTH,
  WAYPOINT_SYMBOL_MAX_LENGTH,
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
