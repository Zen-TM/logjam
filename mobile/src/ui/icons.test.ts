import { describe, expect, it } from "vitest";
import { ICONS } from "@logjam/shared";
import FEATHER_GLYPHS from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json";
import MCI_GLYPHS from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json";

// The phone half of the icon registry guard (the web half is
// frontend/src/ui/icons.test.ts). A name missing from the font's glyph map
// renders as nothing — no error, no fallback — so every `gps` value is looked
// up in the map the font itself uses. `Icon.tsx` also checks this at compile
// time; this is the runtime backstop.
describe("ICONS resolve in the phone's icon fonts", () => {
  for (const [idea, { gps }] of Object.entries(ICONS)) {
    it(`${idea} → ${gps}`, () => {
      const [map, name] = gps.startsWith("mci:")
        ? [MCI_GLYPHS, gps.slice(4)]
        : [FEATHER_GLYPHS, gps];
      expect(name in (map as Record<string, number>)).toBe(true);
    });
  }
});
