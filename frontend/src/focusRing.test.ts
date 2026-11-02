import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Logjam Web has one focus indicator, the ring in index.css. A rule that turns
 * the outline off leaves a keyboard user with nothing (WCAG 2.4.7), and a
 * replacement drawn as a box-shadow disappears in forced-colours mode.
 *
 * So `outline: none` / `outline: 0` is allowed only where something else draws
 * the ring, or where focus lands by script and never by Tab. Each exception
 * below says which. Mutation: write `outline: none` in `ui/Button.module.css`,
 * and this lists it.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

const ALLOWED: Record<string, string> = {
  "components/sidebar/BottomSheet.module.css :: .handle:focus-visible":
    "the ring is drawn on the grip, not the full-width bar",
  "components/weather/WeatherView.module.css :: .root:focus":
    "focus lands here from script, never by Tab",
  "components/map/MapSearchBox.module.css :: .input:focus-visible":
    ".field:focus-within draws the ring around the whole box",
  "ui/Row.module.css :: .open:focus-visible":
    ".row:has(.open:focus-visible) draws the ring on the card",
  "ui/TextField.module.css :: .searchInput:focus-visible":
    ".search:focus-within draws the ring around the whole pill",
  "ui/Dialog.module.css :: .title:focus-visible":
    "focus lands on the title from script when the dialog opens",
  "ui/SideSheet.module.css :: .title:focus-visible":
    "focus lands on the title from script when the sheet opens",
  "ui/Menu.module.css :: .menu:focus-visible":
    "the popover itself takes focus from script; its items carry the ring",
  "ui/Menu.module.css :: .popover:focus-visible":
    "the popover itself takes focus from script; its contents carry the ring",
};

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? stylesheets(join(dir, entry.name))
      : entry.name.endsWith(".css")
        ? [join(dir, entry.name)]
        : [],
  );
}

/** Every `file :: selector` whose declarations switch the outline off. */
function outlineOffRules(): string[] {
  return stylesheets(SRC).flatMap((path) => {
    const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const file = relative(SRC, path);
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(
      ([, selector, body]) =>
        /(^|[\s;])outline:\s*(none|0)\s*(;|$|!)/.test(body)
          ? [`${file} :: ${selector.trim().replace(/\s+/g, " ")}`]
          : [],
    );
  });
}

describe("focus ring", () => {
  it("is switched off only where something else draws it", () => {
    expect(outlineOffRules().filter((rule) => !(rule in ALLOWED))).toEqual([]);
  });

  it("allows only rules that still exist", () => {
    const found = new Set(outlineOffRules());
    expect(Object.keys(ALLOWED).filter((rule) => !found.has(rule))).toEqual([]);
  });
});
