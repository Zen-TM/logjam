import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("the map's furniture", () => {
  // Mutation: drop the narrow-width guard, and a desktop starts with its
  // credits closed too; drop the call, and a phone opens them over the map.
  it("collapses the credits on a narrow map only", () => {
    expect(read("Map.tsx")).toMatch(
      /window\.innerWidth <= MOBILE_MAX_WIDTH_PX\)\s*{\s*collapseCreditsOnce\(credits\)/,
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
