import {
  CONTROL,
  FONT,
  FONT_WEIGHT,
  RADIUS,
  SPACE,
  THEME_SCHEMES,
  THEME_SCHEME_ORDER,
  TOUCH_TARGET_MIN,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";

import {
  controlSize,
  fontSize,
  fontWeight,
  radius,
  spacing,
  textScale,
  theme,
  touchTargetMin,
} from "./theme";

/**
 * Logjam GPS exposes exactly the shared token set, under the shared names —
 * the counterpart of Logjam Web's `tokens.generated.test.ts`. A colour or a
 * step that exists on one client only is the drift this catches.
 *
 * Mutations that turn it red: give `theme` a key of its own
 * (`{ ...tokens, hero: "#000" }`), or make `spacing` `n * 4`.
 */
describe("theme parity with @logjam/shared", () => {
  it("exposes every colour role and nothing else", () => {
    const roles = Object.keys(THEME_SCHEMES.sandstone.tokens).sort();
    for (const id of THEME_SCHEME_ORDER) {
      expect(Object.keys(THEME_SCHEMES[id].tokens).sort()).toEqual(roles);
    }
    expect(Object.keys(theme).sort()).toEqual(roles);
  });

  it("lays out on the shared spacing steps", () => {
    for (const [step, px] of Object.entries(SPACE)) {
      expect(spacing(Number(step))).toBe(px);
    }
  });

  it("reads radius, type, weight and control sizes from the shared scales", () => {
    expect(radius).toEqual(RADIUS);
    expect(Object.keys(fontSize).sort()).toEqual(Object.keys(FONT.gps).sort());
    for (const [name, px] of Object.entries(FONT.gps)) {
      expect(fontSize[name as keyof typeof fontSize]).toBe(
        Math.round(px * textScale),
      );
    }
    expect(fontWeight).toEqual(
      Object.fromEntries(
        Object.entries(FONT_WEIGHT).map(([n, w]) => [n, String(w)]),
      ),
    );
    expect(controlSize).toEqual(CONTROL.touch);
    expect(touchTargetMin).toBe(TOUCH_TARGET_MIN);
  });
});
