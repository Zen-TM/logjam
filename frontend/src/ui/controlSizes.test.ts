import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * DESIGN.md §4, "Density": every control height in the kit reads a
 * `--control-*` token, so density is decided in index.css alone and a coarse
 * pointer can raise it. A hard-coded `min-height` undoes both without a sound —
 * the page still looks right under a mouse.
 */
const KIT_DIR = dirname(fileURLToPath(import.meta.url));

// Heights that are deliberately not panel controls, and why. May only shrink.
const EXEMPT: Record<string, string> = {
  "MapControl.module.css": "map chrome keeps its own, larger step",
  "Feedback.module.css": "the toast floats over the map and is sized with the map chrome",
  "Row.module.css": "a card, not a control; its height follows its text",
};

const kitStylesheets = () => readdirSync(KIT_DIR).filter((name) => name.endsWith(".module.css"));

describe("kit control sizes", () => {
  it("reads the tokens it is guarding", () => {
    expect(readFileSync(join(KIT_DIR, "Button.module.css"), "utf8")).toContain("var(--control-md)");
  });

  it("writes no min-height in px outside the exempt files", () => {
    const offenders = kitStylesheets()
      .filter((name) => !(name in EXEMPT))
      .flatMap((name) =>
        readFileSync(join(KIT_DIR, name), "utf8")
          .split("\n")
          .flatMap((line, index) => (/min-height:\s*\d+px/.test(line) ? [`${name}:${index + 1}: ${line.trim()}`] : [])),
      );
    expect(offenders).toEqual([]);
  });

  it("exempts only files that exist", () => {
    const present = new Set(kitStylesheets());
    expect(Object.keys(EXEMPT).filter((name) => !present.has(name))).toEqual([]);
  });
});
