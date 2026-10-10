import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { chainBeforeIds, PIN_FLOOR, ROUTES_FLOOR } from "./layerOrder";

const SRC = join(__dirname, "..");

function tsxFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFilesUnder(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("chainBeforeIds", () => {
  it("puts each layer under the next and the last under the anchor", () => {
    expect(chainBeforeIds(["a", "b", "c"], "top")).toEqual({
      a: "b",
      b: "c",
      c: "top",
    });
    expect(chainBeforeIds([], "top")).toEqual({});
  });
});

// The floors are ids hard-coded in layer files; renaming one there would make
// every anchored layer wait forever for a layer that never appears.
describe("the floor layers exist", () => {
  it.each([
    [PIN_FLOOR, "map/PlacePinsLayer.tsx"],
    [ROUTES_FLOOR, "map/RoutesLayer.tsx"],
  ])("%s is mounted by %s", (id, file) => {
    expect(readFileSync(join(SRC, file), "utf8")).toContain(id);
  });
});

// A layer mounted with neither an index nor an anchor goes on top of the stack
// when it mounts. That is right for the route being drawn and for the pins
// themselves; for anything else it buries the pins the first time it toggles
// on after them. A new layer file must anchor or be added here on purpose.
//
// Markers the user is pointing at (their own position, a tapped or picked
// point) are on top by design too, by id.
const TOP_MARKER = /user-location|tapped-point|pick-point/;
const TOP_OF_STACK_BY_DESIGN = new Set([
  "map/PlacePinsLayer.tsx",
  "map/RoutesLayer.tsx",
  "map/RouteDraftLayer.tsx",
  "map/FocusPulse.tsx",
  "map/layerOrder.test.ts",
  "map/layerKeys.test.ts",
]);

describe("no unanchored layer can bury the place pins", () => {
  const files = tsxFilesUnder(SRC)
    .map((path) => path.slice(SRC.length + 1))
    .filter((rel) => !TOP_OF_STACK_BY_DESIGN.has(rel))
    .filter((rel) => /<Layer\b/.test(readFileSync(join(SRC, rel), "utf8")));

  it("finds the layer files at all", () => {
    expect(files).toContain("map/PlaceRoutesLayer.tsx");
  });

  it.each(files)("%s", (rel) => {
    const elements = [
      ...readFileSync(join(SRC, rel), "utf8").matchAll(/<Layer\b[\s\S]*?\/>/g),
    ].map((m) => m[0]);
    const unanchored = elements.filter(
      (el) =>
        !/layerIndex|beforeId|\{\.\.\.props\}/.test(el) && !TOP_MARKER.test(el),
    );
    expect(unanchored).toEqual([]);
  });
});
