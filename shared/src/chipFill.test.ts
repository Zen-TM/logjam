import { describe, expect, it } from "vitest";
import { chipFill, contrastRatio } from "./chipFill.js";
import {
  ASSET_HUES,
  PLACE_STATUS_HUES,
  TRIP_TYPE_OPEN_HUES,
} from "./designTokens.js";
import { FRIEND_AVATAR_HUES } from "./friendSearch.js";
import { PLACE_TYPE_COLORS } from "./placeTypes.js";
import { THEME_SCHEMES, THEME_SCHEME_ORDER } from "./themeSchemes.js";

const IDENTITY_HUES: string[] = [
  ...PLACE_TYPE_COLORS,
  ...Object.values(ASSET_HUES),
  ...Object.values(TRIP_TYPE_OPEN_HUES),
  ...Object.values(PLACE_STATUS_HUES),
  ...FRIEND_AVATAR_HUES,
];

const hueAngle = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const max = Math.max(r!, g!, b!);
  const d = max - Math.min(r!, g!, b!);
  if (d === 0) return 0;
  const h =
    max === r!
      ? ((g! - b!) / d) % 6
      : max === g!
        ? (b! - r!) / d + 2
        : (r! - g!) / d + 4;
  return (h * 60 + 360) % 360;
};

describe("chipFill", () => {
  // Mutation: return `hue` unchanged, and a selected chip in Ghost Gum is
  // 1.5:1 against the unselected one beside it (WCAG 1.4.11); or measure the
  // card alone, and a lone chip on the page falls to 2.7:1.
  it.each(THEME_SCHEME_ORDER)(
    "%s: every hue and the scheme's own accent and neutral stand 3:1 off the card and the page, with 4.5:1 ink",
    (id) => {
      const { tokens } = THEME_SCHEMES[id];
      for (const hue of [...IDENTITY_HUES, tokens.accent, tokens.neutral]) {
        const fill = chipFill(hue, tokens);
        expect(
          contrastRatio(fill, tokens.card),
          `${id} ${hue}→${fill}`,
        ).toBeGreaterThanOrEqual(3);
        expect(
          contrastRatio(tokens.onFill, fill),
          `${id} ${hue}→${fill}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  // Mutation: shift every hue, and tiles' and chips' pastels stop matching
  // where they already pass.
  it("leaves a hue that already passes untouched", () => {
    expect(chipFill("#BED9B5", THEME_SCHEMES.basalt.tokens)).toBe("#BED9B5");
  });

  // Mutation: mix toward grey instead of black/white, and a chip's hue turns
  // into another one.
  it("keeps each hue recognisably itself", () => {
    for (const id of THEME_SCHEME_ORDER) {
      const { tokens } = THEME_SCHEMES[id];
      for (const hue of IDENTITY_HUES) {
        const fill = chipFill(hue, tokens);
        if (fill === hue) continue;
        const gap = Math.abs(hueAngle(fill) - hueAngle(hue));
        expect(Math.min(gap, 360 - gap), `${id} ${hue}→${fill}`).toBeLessThan(
          15,
        );
      }
    }
  });
});
