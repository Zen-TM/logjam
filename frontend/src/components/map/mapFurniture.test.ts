import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("the map's furniture", () => {
  // Mutation: delete the collapse in Map.tsx, and the credits open over a
  // quarter of a phone's map on load.
  it("collapses the credits as soon as they first open", () => {
    expect(read("Map.tsx")).toMatch(
      /classList\.remove\(open\)[\s\S]*MutationObserver/,
    );
  });

  // Mutation: drop the `:has(.maplibregl-compact-show)` rule, and the open
  // credits cover the compass and the scale bar at 390 px.
  it("lifts open credits clear of the compass and scale bar", () => {
    expect(read("Map.module.css")).toContain(
      ".maplibregl-ctrl-bottom-right:has(.maplibregl-compact-show)",
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
