import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  basemapMountKeys,
  chainBeforeIds,
  PIN_FLOOR,
  ROUTES_FLOOR,
} from "./layerOrder";

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

describe("basemapMountKeys", () => {
  const raster = (key: string) => ({ key, sourceType: "raster" });
  const vector = (key: string) => ({ key, sourceType: "vector" });

  // Mutation: give `terrain` one value whatever the basemaps, and after a
  // switch from imagery to the vector map the contour lines stay over the
  // roads and labels.
  it("remounts the Terrain group when it moves into the vector map or out", () => {
    const imagery = basemapMountKeys([raster("six-imagery")]);
    expect(basemapMountKeys([vector("protomaps")]).terrain).not.toBe(
      imagery.terrain,
    );
    expect(basemapMountKeys([raster("six-topo")]).terrain).toBe(
      imagery.terrain,
    );
  });

  // Mutation: leave the basemaps out of `stacks`, and offline a newly saved
  // area's stack mounts under the older ones', the Terrain group in it.
  it("remounts every stack and the Terrain group when a saved area joins", () => {
    const one = basemapMountKeys([vector("region-a")]);
    const two = basemapMountKeys([vector("region-b"), vector("region-a")]);
    expect(two.stacks).not.toBe(one.stacks);
    expect(two.terrain).not.toBe(one.terrain);
  });
});

// Mutation: key a basemap stack or a Terrain `ResolvedSource` in MapScreen by
// its own source alone (`r.key`), and the keys above never reach the map: after
// a switch from imagery to the vector map the contour lines stay over the roads.
describe("MapScreen keys its stacks and the Terrain group by basemapMountKeys", () => {
  const source = readFileSync(join(SRC, "map/MapScreen.tsx"), "utf8");
  it.each([
    ["basemapResolved", "stacks", "resolved"],
    ["hillshadeResolved", "terrain", "r"],
    ["slopeResolved", "terrain", "r"],
    ["contoursResolved", "terrain", "r"],
  ])("%s by mountKeys.%s", (list, mount, item) => {
    // The first ResolvedSource after `{list.map(`, before the next `.map(`.
    const keyed = new RegExp(
      String.raw`\{${list}\.map\((?:(?!\.map\()[\s\S])*?<ResolvedSource\s+key=\{\`\$\{${item}\.key\}@\$\{mountKeys\.${mount}\}\`\}`,
    );
    expect(source).toMatch(keyed);
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
