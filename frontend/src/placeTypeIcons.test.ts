import { describe, it, expect } from "vitest";
import * as lucide from "lucide-react";
import { PLACE_TYPE_ICON_KEYS, SYSTEM_PLACE_TYPES } from "@logjam/shared";

// Plan §7.8, the WEB half. Its twin is mobile/src/places/placeTypeIcons.test.ts,
// which checks the same curated list against Feather's glyph map. Two tests
// because neither client can see the other's icon set, and a key that resolves
// on one platform and not the other is invisible to whoever chose it.
//
// lucide exports PascalCase components, so `map-pin` is `MapPin` — the same
// transformation the web renderer will do.
function componentName(key: string): string {
  return key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

describe("place type icon keys resolve in lucide", () => {
  it("has every curated key", () => {
    const missing = PLACE_TYPE_ICON_KEYS.filter(
      (key) => !(componentName(key) in lucide),
    );
    expect(
      missing,
      "these icon keys have no lucide component and would render nothing on the web",
    ).toEqual([]);
  });

  it("has every system type's icon", () => {
    for (const type of SYSTEM_PLACE_TYPES) {
      expect(
        componentName(type.iconKey) in lucide,
        `system type "${type.name}" uses icon "${type.iconKey}", which lucide does not have`,
      ).toBe(true);
    }
  });
});
