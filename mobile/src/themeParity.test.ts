import {
  CONTROL,
  FONT,
  FONT_WEIGHT,
  RADIUS,
  SPACE,
  type SpaceStep,
  TEXT_ROLES,
  THEME_SCHEMES,
  THEME_SCHEME_ORDER,
  TOUCH_TARGET_MIN,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";

import {
  controlSize,
  fontSize,
  fontWeight,
  GPS_ROLES,
  radius,
  spacing,
  textRolesFor,
  textScale,
  touchTargetMin,
} from "./theme";

/**
 * Logjam GPS exposes exactly the shared token set, under the shared names —
 * the counterpart of Logjam Web's `tokens.generated.test.ts`. A colour or a
 * step that exists on one client only is the drift this catches.
 *
 * Mutations that turn it red: give one scheme a role of its own
 * (`hero: "#000"`), or make `spacing` `n * 4`.
 */
describe("theme parity with @logjam/shared", () => {
  it("exposes every colour role and nothing else", () => {
    const roles = Object.keys(THEME_SCHEMES.sandstone.tokens).sort();
    for (const id of THEME_SCHEME_ORDER) {
      expect(Object.keys(THEME_SCHEMES[id].tokens).sort()).toEqual(roles);
    }
  });

  it("lays out on the shared spacing steps", () => {
    for (const [step, px] of Object.entries(SPACE)) {
      expect(spacing(Number(step) as SpaceStep)).toBe(px);
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

  // `textRole.<name>` is the role's size and weight from the shared scale, in
  // this launch's text scale. Mutation that turns it red: change a role's
  // `size` in `TEXT_ROLES` without the style following, e.g. hand `title` the
  // `fontSize.lg` in `theme.ts`.
  it("draws every type role at the size and weight the shared table names", () => {
    // Not the launch scheme: a muted role follows the scheme it is asked for.
    const theme = THEME_SCHEMES[THEME_SCHEME_ORDER.at(-1)!].tokens;
    const textRole = textRolesFor(theme);
    expect(Object.keys(textRole).sort()).toEqual(
      [...Object.keys(TEXT_ROLES), ...Object.keys(GPS_ROLES)].sort(),
    );
    const specs = [
      ...Object.entries(TEXT_ROLES).map(([name, spec]) => [name, spec.gps]),
      ...Object.entries(GPS_ROLES),
    ] as [string, Record<string, string | true>][];
    for (const [name, role] of specs) {
      const style = textRole[name as keyof typeof textRole];
      expect(style.fontSize).toBe(
        Math.round(FONT.gps[role.size as keyof typeof FONT.gps] * textScale),
      );
      expect(style.fontWeight).toBe(
        String(FONT_WEIGHT[role.weight as keyof typeof FONT_WEIGHT]),
      );
      expect(style.textTransform === "uppercase").toBe("uppercase" in role);
      expect(style.color === theme.textMuted).toBe("muted" in role);
      // Only a paragraph's lines are set apart; the rest take the font's own.
      expect(style.lineHeight !== undefined).toBe("leading" in role);
    }
  });

  // Mutation: add a name to `GPS_ROLES` that `TEXT_ROLES` already holds.
  it("holds no role in both tables", () => {
    for (const name of Object.keys(GPS_ROLES)) {
      expect(Object.keys(TEXT_ROLES)).not.toContain(name);
    }
  });
});
