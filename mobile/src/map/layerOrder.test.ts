import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_SCHEME_ID,
  drawsOverTerrain,
  terrainBeforeIds,
  THEME_SCHEMES,
} from "@logjam/shared";

import {
  PROTOMAPS_FLAVOR,
  protomapsBandMarkers,
  protomapsLayerDefs,
} from "./basemap/protomapsLayers";
import { buildShellStyle } from "./basemap/shellStyle";
import {
  chainBeforeIds,
  PIN_FLOOR,
  ROUTES_FLOOR,
  terrainBandMarker,
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

// Mutation: put a band's marker out of order in the shell, or send a stack's
// water to the top band, and the roads of one saved area end up under the
// contours or the water of another over them.
describe("two saved areas and the Terrain group", () => {
  /** MLRN's `beforeId`: directly under the anchor, whatever is already there. */
  const under = (style: string[], id: string, beforeId: string) =>
    style.splice(style.indexOf(beforeId), 0, id);
  const mountStack = (style: string[], area: string) => {
    const markers = protomapsBandMarkers(PROTOMAPS_FLAVOR);
    protomapsLayerDefs(PROTOMAPS_FLAVOR).forEach((layer, i) =>
      under(style, `${area}/${layer.id}`, markers[i]),
    );
  };
  const mountTerrain = (style: string[]) => {
    const pairs = terrainBeforeIds(
      {
        hillshade: ["hillshade"],
        land: ["land"],
        slope: ["slope"],
        contours: ["contours"],
      },
      terrainBandMarker,
    );
    for (const [id, beforeId] of pairs) under(style, id, beforeId);
  };
  const shell = () =>
    buildShellStyle(
      null,
      PROTOMAPS_FLAVOR,
      THEME_SCHEMES[DEFAULT_THEME_SCHEME_ID].tokens,
    ).layers.map((l) => l.id);

  it.each([
    ["a saved area joins after the Terrain group", ["older", "t", "newer"]],
    ["the map mounts them in one go", ["older", "newer", "t"]],
  ])("every road and label draws over all of it: %s", (_, order) => {
    const style = shell();
    for (const step of order) {
      if (step === "t") mountTerrain(style);
      else mountStack(style, step);
    }
    const at = (id: string) => style.indexOf(id);
    const layers = protomapsLayerDefs(PROTOMAPS_FLAVOR);
    const over = layers.filter(drawsOverTerrain);
    expect(over.length).toBeGreaterThan(0);
    for (const area of ["older", "newer"]) {
      expect(at(`${area}/earth`)).toBeLessThan(at("hillshade"));
      expect(at("hillshade")).toBeLessThan(at(`${area}/water`));
      expect(at(`${area}/water`)).toBeLessThan(at("slope"));
      for (const layer of over) {
        expect(at(`${area}/${layer.id}`)).toBeGreaterThan(at("contours"));
      }
    }
    expect(at("slope")).toBeLessThan(at("contours"));
    // Where saves overlap, the newest draws on top.
    expect(at("older/earth")).toBeLessThan(at("newer/earth"));
    expect(at("older/places_locality")).toBeLessThan(
      at("newer/places_locality"),
    );
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
