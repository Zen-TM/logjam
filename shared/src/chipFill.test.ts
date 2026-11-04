import { describe, expect, it } from "vitest";
import { chipFill, contrastRatio } from "./chipFill.js";
import {
  ASSET_HUES,
  OPACITY,
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

// CIE76 distance in CIELAB: a colour difference, not a contrast ratio.
const lab = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const x = (0.4124 * r! + 0.3576 * g! + 0.1805 * b!) / 0.95047;
  const y = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  const z = (0.0193 * r! + 0.1192 * g! + 0.9505 * b!) / 1.08883;
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const deltaE = (a: string, b: string) => {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

describe("a scheme's neutral", () => {
  // Mutation: set Scribbly Gum's `neutral` to #C4DBBE (4.2 from Campsite's scrub
  // green) or back to #A8C4A1 (14 from its `success`, near the pale greens),
  // and "no kind" reads as a place type or as the good state.
  it.each(THEME_SCHEME_ORDER)(
    "%s: stands at least 7 CIELAB units from every identity hue and from success",
    (id) => {
      const { neutral, success } = THEME_SCHEMES[id].tokens;
      for (const hue of IDENTITY_HUES)
        expect(
          deltaE(neutral, hue),
          `${id} ${neutral} vs ${hue}`,
        ).toBeGreaterThanOrEqual(7);
      expect(
        deltaE(neutral, success),
        `${id} vs success`,
      ).toBeGreaterThanOrEqual(7);
    },
  );
});

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
        for (const ground of [tokens.card, tokens.page]) {
          expect(
            contrastRatio(fill, ground),
            `${id} ${hue}→${fill}`,
          ).toBeGreaterThanOrEqual(3);
        }
        expect(
          contrastRatio(tokens.onFill, fill),
          `${id} ${hue}→${fill}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  // A filled button under the pointer dims its fill to `OPACITY.pressed` and
  // keeps its label solid (Button.module.css). Mutation that turns it red: set
  // `OPACITY.pressed` to 0.3.
  it.each(THEME_SCHEME_ORDER)(
    "%s: a pressed accent or warning fill keeps 4.5:1 ink on the page and the card",
    (id) => {
      const { tokens } = THEME_SCHEMES[id];
      const mix = (fill: string, ground: string) =>
        `#${[1, 3, 5]
          .map((i) => {
            const f = parseInt(fill.slice(i, i + 2), 16);
            const g = parseInt(ground.slice(i, i + 2), 16);
            return Math.round(f * OPACITY.pressed + g * (1 - OPACITY.pressed))
              .toString(16)
              .padStart(2, "0");
          })
          .join("")}`;
      for (const fill of [tokens.accent, tokens.warning]) {
        for (const ground of [tokens.page, tokens.card]) {
          expect(
            contrastRatio(tokens.onFill, mix(fill, ground)),
            `${id} ${fill} on ${ground}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
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
