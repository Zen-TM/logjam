import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * MapLibre's credits are restyled, never rebuilt (DESIGN.md §2), and two things
 * about them are decided in CSS only:
 *
 * - open and wrapped, they are a box and not a stadium: `--radius-pill` ends
 *   would clip the text;
 * - they stop short of the action column, so no panel, sheet or width puts them
 *   under a map button or a button over them.
 *
 * Mutation that turns it red: give `.maplibregl-compact` the
 * `--radius-pill`, or set the bottom-right control's `right` back to a literal.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const css = (file: string) =>
  readFileSync(join(HERE, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule whose selector contains `selector`. */
function rule(sheet: string, selector: string): string {
  const at = Math.max(
    sheet.indexOf(`${selector} {`),
    sheet.indexOf(`${selector}) {`),
  );
  expect(at, `${selector} rule`).toBeGreaterThan(-1);
  return sheet.slice(at, sheet.indexOf("}", at));
}

describe("map credits", () => {
  const map = css("Map.module.css");

  it("is a rounded box, never a stadium", () => {
    expect(
      rule(map, "#map .maplibregl-ctrl-attrib.maplibregl-compact"),
    ).toContain("border-radius: var(--radius-lg)");
    expect(map).not.toMatch(/maplibregl-ctrl-attrib[^{]*\{[^}]*radius-pill/);
  });

  it("clears the action column by the size of a map button", () => {
    expect(rule(map, "#map .maplibregl-ctrl-bottom-right")).toContain(
      "right: var(--map-actions-clear)",
    );
    expect(rule(map, ".map")).toContain("--map-button-size");
    expect(rule(css("../../ui/MapControl.module.css"), ".mapButton")).toContain(
      "width: var(--map-button-size)",
    );
  });
});
