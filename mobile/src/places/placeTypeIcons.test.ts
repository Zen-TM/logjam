import { describe, it, expect } from "vitest";
import { PLACE_TYPE_ICON_KEYS, SYSTEM_PLACE_TYPES } from "@logjam/shared";

// Plan §7.8, the MOBILE half. A place type's `iconKey` is platform-neutral and
// each client maps it to its own icon set — mobile draws Feather, web draws
// lucide. Neither client can check the other, so the guard is two tests, one on
// each side, over the same curated list.
//
// Read from the vendored glyph map rather than by rendering: this is a vitest
// suite with no native runtime, and the glyph map is the actual thing
// `<Feather name=...>` looks the name up in. A key missing from it renders
// nothing at all — no error, no fallback, just an empty space where the type's
// icon should be.
import FEATHER_GLYPHS from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json";

import { placeTypeFeatherIcon } from "./placeTypeIcon";

describe("place type icon keys resolve in Feather", () => {
  it("has every curated key", () => {
    const missing = PLACE_TYPE_ICON_KEYS.filter(
      (key) => !(key in (FEATHER_GLYPHS as Record<string, number>)),
    );
    expect(
      missing,
      "these icon keys do not exist in Feather and would render as blank on the phone",
    ).toEqual([]);
  });

  // The system types ship with icons chosen before any picker existed, so they
  // are the ones most likely to have been set to a name from the wrong set —
  // `waves` and `tent` are lucide-only, and both were the first choice here.
  it("has every system type's icon", () => {
    for (const type of SYSTEM_PLACE_TYPES) {
      expect(
        type.iconKey in (FEATHER_GLYPHS as Record<string, number>),
        `system type "${type.name}" uses icon "${type.iconKey}", which Feather does not have`,
      ).toBe(true);
    }
  });

  it("offers every system type's icon in the picker grid", () => {
    for (const type of SYSTEM_PLACE_TYPES) {
      expect(PLACE_TYPE_ICON_KEYS as readonly string[]).toContain(type.iconKey);
    }
  });
});

describe("placeTypeFeatherIcon", () => {
  it("passes a curated key straight through", () => {
    for (const key of PLACE_TYPE_ICON_KEYS) {
      expect(placeTypeFeatherIcon(key)).toBe(key);
    }
  });

  // The case the fallback exists for: a type created against a newer server.
  it("falls back to the pin for a key this build does not know", () => {
    expect(placeTypeFeatherIcon("tent")).toBe("map-pin");
  });
});
