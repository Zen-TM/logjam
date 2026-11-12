import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Logjam Web has one focus indicator, the ring in index.css. A rule that turns
 * the outline off leaves a keyboard user with nothing (WCAG 2.4.7), and a
 * replacement drawn as a box-shadow disappears in forced-colours mode.
 *
 * So `outline: none` / `outline: 0` / `outline-style: none` / `outline:
 * transparent` is allowed only where something else draws the ring, or where
 * focus lands by script and never by Tab. Each exception below says which, and
 * where another rule draws it, `via` names that selector and the test checks
 * the same stylesheet gives it a real outline. Mutations: write `outline: none`
 * in `ui/Button.module.css`; or delete the `.field:focus-within` rule from
 * `components/map/MapSearchBox.module.css` while its `.input` still says none.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

type Allowed = { why: string; via?: string };
const ALLOWED: Record<string, Allowed> = {
  "components/sidebar/BottomSheet.module.css :: .handle:focus-visible": {
    why: "the ring is drawn on the grip, not the full-width bar",
    via: ".handle:focus-visible .grip",
  },
  "components/weather/WeatherView.module.css :: .root:focus": {
    why: "focus lands here from script, never by Tab",
  },
  "components/map/MapSearchBox.module.css :: .input:focus-visible": {
    why: "the ring goes around the whole box",
    via: ".field:focus-within",
  },
  "ui/Row.module.css :: .open:focus-visible": {
    why: "the ring goes on the card the stretched button covers",
    via: ".row:has(.open:focus-visible)",
  },
  "ui/TextField.module.css :: .searchInput:focus-visible": {
    why: "the ring goes around the whole pill",
    via: ".search:focus-within",
  },
  "ui/Dialog.module.css :: .title:focus-visible": {
    why: "focus lands on the title from script when the dialog opens",
  },
  "ui/SideSheet.module.css :: .title:focus-visible": {
    why: "focus lands on the title from script when the sheet opens",
  },
  "components/gauges/GaugeView.module.css :: .chooser:focus": {
    why: "focus lands on the chooser from script when it opens; its rows carry the ring",
  },
  "components/sidebar/SidebarPanel.module.css :: .panel:focus-visible": {
    why: "focus lands on the panel from the Skip to panel link, never by Tab",
  },
  "ui/Menu.module.css :: .menu:focus-visible": {
    why: "the popover itself takes focus from script; its items carry the ring",
  },
  "ui/Menu.module.css :: .popover:focus-visible": {
    why: "the popover itself takes focus from script; its contents carry the ring",
  },
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

type Rule = { file: string; selector: string; body: string };

function rules(): Rule[] {
  return stylesheets(SRC).flatMap((path) => {
    const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const file = relative(SRC, path);
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
      ([, selector, body]) => ({
        file,
        selector: selector.trim().replace(/\s+/g, " "),
        body,
      }),
    );
  });
}

const OFF =
  /(^|[\s;])(outline:\s*(none|0|transparent)|outline-style:\s*none)\s*(;|$|!)/;
const ON = /(^|[\s;])outline:\s*(?!none\b|0\b|transparent\b)[^;]*\d+px/;

/** Every `file :: selector` whose declarations switch the outline off. */
const outlineOffRules = () =>
  rules()
    .filter((rule) => OFF.test(rule.body))
    .map((rule) => `${rule.file} :: ${rule.selector}`);

describe("focus ring", () => {
  it("is switched off only where something else draws it", () => {
    expect(outlineOffRules().filter((rule) => !(rule in ALLOWED))).toEqual([]);
  });

  it("allows only rules that still exist", () => {
    const found = new Set(outlineOffRules());
    expect(Object.keys(ALLOWED).filter((rule) => !found.has(rule))).toEqual([]);
  });

  it("names, for each ring drawn elsewhere, a rule that draws one", () => {
    const all = rules();
    const missing = Object.entries(ALLOWED).flatMap(([key, { via }]) => {
      if (!via) return [];
      const file = key.split(" :: ")[0];
      return all.some(
        (rule) =>
          rule.file === file && rule.selector === via && ON.test(rule.body),
      )
        ? []
        : [`${key} -> ${via}`];
    });
    expect(missing).toEqual([]);
  });
});
