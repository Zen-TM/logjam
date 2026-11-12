import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("the map's furniture", () => {
  // Mutation: drop the call, and the credits open over the map at any width.
  it("collapses the credits at every width", () => {
    expect(read("Map.tsx")).toMatch(
      /if \(credits\) collapseCreditsOnce\(credits\)/,
    );
  });

  // Mutation: drop the `:has(.maplibregl-compact-show)` rule, and the open
  // credits cover the compass and the scale bar at 390 px.
  it("lifts open credits clear of the compass and scale bar", () => {
    const css = read("Map.module.css");
    expect(css).toContain(
      ".maplibregl-ctrl-bottom-right:has(.maplibregl-compact-show)",
    );
    // Mutation: drop the max-width override, and the lifted credits wrap to
    // the 240 px floor on a row with room for a line.
    expect(css).toMatch(
      /maplibregl-ctrl-attrib\.maplibregl-compact-show\)\s*{\s*max-width: calc\(100vw/,
    );
  });

  // Mutation: drop the `activePanel` test, and the chip follows you onto Logs,
  // Ways and every other page.
  it("shows the Places filter chip on the map and Places only", () => {
    expect(read("../App.tsx")).toMatch(
      /filtersActive &&\s*!dimUI &&\s*\(activePanel === null \|\| activePanel === "places"\)/,
    );
  });
});
