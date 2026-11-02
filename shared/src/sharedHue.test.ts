import { describe, expect, it } from "vitest";

import {
  ASSET_HUES,
  MEDAL_HUES,
  PLACE_STATUS_HUES,
  TRIP_TYPE_OPEN_HUES,
} from "./designTokens.js";
import { FRIEND_AVATAR_HUES } from "./friendSearch.js";
import {
  PLACE_TYPE_COLORS,
  SHARED_PLACE_COLOR,
  VISITED_PLACE_COLOR,
} from "./placeTypes.js";

// "Shared" is one hue for one idea. Mutation: set `ASSET_HUES.track` (or any
// entry of another map below) back to `SHARED_PLACE_COLOR`'s hex and this goes red.
describe("SHARED_PLACE_COLOR", () => {
  const maps: Record<string, readonly string[]> = {
    ASSET_HUES: Object.values(ASSET_HUES),
    TRIP_TYPE_OPEN_HUES: Object.values(TRIP_TYPE_OPEN_HUES),
    FRIEND_AVATAR_HUES,
    PLACE_TYPE_COLORS,
    MEDAL_HUES: Object.values(MEDAL_HUES),
    "PLACE_STATUS_HUES (not shared)": [PLACE_STATUS_HUES.todo],
    VISITED_PLACE_COLOR: [VISITED_PLACE_COLOR],
  };

  it.each(Object.entries(maps))("is not in %s", (_name, hues) => {
    expect(hues.map((h) => h.toUpperCase())).not.toContain(
      SHARED_PLACE_COLOR.toUpperCase(),
    );
  });
});
