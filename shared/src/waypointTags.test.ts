import { describe, expect, it } from "vitest";

import {
  COLORED_WAYPOINT_TAGS,
  DEFAULT_WAYPOINT_COLOR,
  waypointColor,
} from "./waypointTags.js";
import { WAYPOINT_TAG_SUGGESTIONS } from "./waypointValidation.js";

describe("waypointColor", () => {
  it("derives from the first tag", () => {
    expect(waypointColor({ tags: ["carpark"] })).toBe("#86B5D4");
  });

  it("keeps the first tag's answer when a later tag also has a colour", () => {
    // Stability: adding an entry must not repaint waypoints that merely carry
    // that tag in second place.
    expect(waypointColor({ tags: ["abseil", "carpark"] })).toBe(
      waypointColor({ tags: ["abseil"] }),
    );
  });

  it("is case-insensitive, because the vocabulary is free text", () => {
    expect(waypointColor({ tags: ["CarPark"] })).toBe("#86B5D4");
  });

  it("lets an explicit symbol override the tags", () => {
    expect(waypointColor({ symbol: "campsite", tags: ["carpark"] })).toBe(
      "#9DBE8B",
    );
  });

  it("falls back for an unknown tag, no tags, or nothing at all", () => {
    expect(waypointColor({ tags: ["slippery log"] })).toBe(DEFAULT_WAYPOINT_COLOR);
    expect(waypointColor({ tags: [] })).toBe(DEFAULT_WAYPOINT_COLOR);
    expect(waypointColor({})).toBe(DEFAULT_WAYPOINT_COLOR);
  });

  it("gives every suggested tag a colour of its own", () => {
    // The seed vocabulary is what the pickers offer first, so a suggestion
    // that renders as the default pin makes the seed look arbitrary.
    for (const tag of WAYPOINT_TAG_SUGGESTIONS) {
      expect(COLORED_WAYPOINT_TAGS).toContain(tag);
      expect(waypointColor({ tags: [tag] })).not.toBe(DEFAULT_WAYPOINT_COLOR);
    }
  });
});
