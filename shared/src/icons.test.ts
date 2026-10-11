import { describe, expect, it } from "vitest";
import { ICONS } from "./icons.js";
import { TRIP_TYPE_ICON_KEYS } from "./tripTypeIdentity.js";

// Existence in each icon set is checked where the sets are importable:
// frontend/src/ui/icons.test.ts (Lucide) and mobile/src/ui/icons.test.ts
// (Feather / MaterialCommunityIcons). What only the registry can answer is here.
describe("ICONS", () => {
  const entries = Object.entries(ICONS);

  it("gives no two ideas the same glyph on a client — one glyph, one idea", () => {
    for (const client of ["web", "gps"] as const) {
      const seen = new Map<string, string>();
      for (const [idea, glyphs] of entries) {
        const glyph = glyphs[client];
        expect(
          seen.get(glyph),
          `${client}: "${idea}" and "${seen.get(glyph)}" both draw "${glyph}"`,
        ).toBeUndefined();
        seen.set(glyph, idea);
      }
    }
  });

  it("keeps a trip type's glyph out of the UI vocabulary", () => {
    const drawn = new Set(
      entries.flatMap(([, glyphs]) => [glyphs.web, glyphs.gps]),
    );
    for (const key of TRIP_TYPE_ICON_KEYS) {
      expect(drawn.has(key), `trip type glyph "${key}" is a UI idea`).toBe(
        false,
      );
    }
  });
});
