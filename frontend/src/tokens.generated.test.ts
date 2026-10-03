import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTROL,
  FONT,
  FONT_WEIGHT,
  MOTION,
  OPACITY,
  PLACE_STATUS_HUES,
  ASSET_HUES,
  RADIUS,
  SPACE,
  THEME_SCHEMES,
  THEME_SCHEME_ORDER,
  webTokensCss,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";

/**
 * Logjam Web's tokens are GENERATED from @logjam/shared, so the browser holds
 * no second list of the same values. Two guards:
 *
 * - the committed file is what the generator writes today (turns red when a
 *   shared token changes and nobody regenerated);
 * - the file declares exactly the shared token set, under the kebab-case names
 *   the declaration implies (turns red when the generator drops or invents one:
 *   filter `line` out of `webSchemeProperties`, `make shared`, `npm run tokens`).
 */
const committed = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "tokens.generated.css"),
  "utf8",
);

const kebab = (name: string) =>
  name.replace(/\./g, "-").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Custom-property names declared in one rule block. */
function namesIn(selector: string): string[] {
  const start = committed.indexOf(`${selector} {`);
  expect(start, `${selector} block missing`).toBeGreaterThanOrEqual(0);
  const body = committed.slice(start, committed.indexOf("}", start));
  return [...body.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]).sort();
}

describe("tokens.generated.css", () => {
  it("is what the generator writes (regenerate: `make shared && npm run tokens` in frontend/)", () => {
    expect(committed).toBe(webTokensCss());
  });

  const colourNames = Object.keys(THEME_SCHEMES.sandstone.tokens).map(
    (role) => `--color-${kebab(role)}`,
  );

  it("declares exactly the shared token set on :root", () => {
    const expected = [
      ...Object.keys({ ...ASSET_HUES, ...PLACE_STATUS_HUES }).map(
        (n) => `--hue-${kebab(n)}`,
      ),
      ...Object.keys(SPACE).map((n) => `--space-${kebab(n)}`),
      ...Object.keys(RADIUS).map((n) => `--radius-${n}`),
      ...Object.keys(FONT.web).map((n) => `--font-${n}`),
      ...Object.keys(FONT_WEIGHT).map((n) => `--font-weight-${n}`),
      ...Object.keys(CONTROL.web).map((n) => `--control-${n}`),
      ...Object.keys(MOTION).map((n) => `--motion-${n}`),
      ...Object.keys(OPACITY).map((n) => `--opacity-${n}`),
      ...colourNames,
    ].sort();
    expect(namesIn(":root")).toEqual(expected);
  });

  it("declares every colour role, and only those, for every scheme", () => {
    for (const id of THEME_SCHEME_ORDER) {
      expect(namesIn(`[data-scheme="${id}"]`)).toEqual([...colourNames].sort());
    }
  });
});
