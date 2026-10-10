import { describe, expect, it } from "vitest";

import { INK } from "./designTokens.js";
import { THEME_SCHEMES, THEME_SCHEME_ORDER } from "./themeSchemes.js";
import { kebab, webTokensCss } from "./webTokens.js";

/** The declarations of one rule block, as a name → value map. */
function blockOf(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block missing`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  return new Map(
    [...body.matchAll(/^\s*([\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2]]),
  );
}

describe("webTokensCss", () => {
  const css = webTokensCss();

  it("kebab-cases role, hue and step names", () => {
    expect(kebab("cardPressed")).toBe("card-pressed");
    expect(kebab("geoPdf")).toBe("geo-pdf");
    expect(kebab("1.5")).toBe("1-5");
  });

  it("writes one block per scheme with every role and its mode", () => {
    for (const id of THEME_SCHEME_ORDER) {
      const scheme = THEME_SCHEMES[id];
      const props = blockOf(css, `[data-scheme="${id}"]`);
      expect(props.get("color-scheme")).toBe(scheme.mode);
      for (const [role, hex] of Object.entries(scheme.tokens)) {
        expect(props.get(`--color-${kebab(role)}`)).toBe(hex.toLowerCase());
      }
    }
    expect(blockOf(css, '[data-scheme="ghostGum"]').get("color-scheme")).toBe(
      "light",
    );
  });

  it("paints the default scheme on :root, so the first paint needs no script", () => {
    const root = blockOf(css, ":root");
    expect(root.get("--color-page")).toBe(
      THEME_SCHEMES.sandstone.tokens.page.toLowerCase(),
    );
    expect(root.get("--color-on-fill")).toBe(INK.toLowerCase());
    expect(root.get("--space-1-5")).toBe("12px");
    expect(root.get("--form-field")).toBe("12px");
    expect(root.get("--font-sm")).toBe("0.8125rem");
    expect(root.get("--control-lg")).toBe("36px");
    expect(root.get("--motion-fast")).toBe("150ms");
  });

  it("gives a coarse pointer the touch control sizes", () => {
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(blockOf(coarse, ":root").get("--control-lg")).toBe("48px");
  });
});
