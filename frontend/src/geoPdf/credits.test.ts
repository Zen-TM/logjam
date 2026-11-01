// @vitest-environment node
import {
  NSW_5M,
  type SharpenedArea,
  type TerrainLayerKey,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { upperBoundTerrainLines } from "./credits";
import {
  attributionLines,
  attributionRows,
  type AttributionInput,
} from "./draw/elements";
import { terrainCreditLines } from "./terrain";

const LAYERS: TerrainLayerKey[] = ["hillshade", "slope", "contours"];
const area = (id: string, credit: string): SharpenedArea => ({
  id,
  zmax: 16,
  tiles15: [0, 0, 1, 1],
  coverage: [0, 0, 0, 0],
  contours: true,
  credit,
  createdAt: "2026-10-24T00:00:00.000Z",
});
// Long enough to wrap, made up.
const AREAS = [
  area(
    "a",
    "Elevation: derived from a made-up survey of the first area. CC BY 3.0 AU, with a long licence sentence besides.",
  ),
  area(
    "b",
    "Elevation: derived from a made-up survey of the second area. CC BY 4.0, also long enough to wrap onto lines.",
  ),
];
const ctx = {
  font: "",
  measureText: (text: string) => ({ width: text.length * 6 }),
} as unknown as OffscreenCanvasRenderingContext2D;

const subsets = <T>(items: readonly T[]): T[][] =>
  items.reduce<T[][]>(
    (all, item) => [...all, ...all.map((s) => [...s, item])],
    [[]],
  );

const input = (
  terrainLines: string[],
  overlays: string[],
): AttributionInput => ({
  baseLayer: "six-base",
  renderedOverlays: overlays,
  terrainLines,
  extractedAt: new Date("2026-10-24T00:00:00Z"),
});
const WIDTH = 1500;
const DPI = 300;
const top = (lines: string[]) =>
  attributionRows(lines.length, 2000, 60, DPI).top;

describe("the base map's credit", () => {
  // Mutation: read the credit from GEOPDF_BASE_LAYER_CONFIG, which holds raster
  // bases only, and a print of OSM Vector loses the ODbL credit.
  it("is printed for the vector base", () => {
    const lines = attributionLines(ctx, WIDTH, DPI, {
      ...input([], []),
      baseLayer: "protomaps",
    });
    expect(lines.join(" ")).toContain("OpenStreetMap contributors");
  });
});

describe("the credit block's upper bound", () => {
  // Mutation: build the bound without the areas (drop `upperAreas` in
  // upperBoundTerrainLines), and a page where areas credit a layer prints
  // lines the bound never counted, so a strip under them draws before the
  // last tile has settled.
  it("is never below the block of what really drew", () => {
    let compared = 0;
    for (const requested of subsets(LAYERS)) {
      const upper = attributionLines(
        ctx,
        WIDTH,
        DPI,
        input(upperBoundTerrainLines(new Set(requested), AREAS), [
          "vegetation",
        ]),
      );
      for (const drawn of subsets(requested)) {
        for (const onPage of subsets(AREAS)) {
          // Each area on the page supplied some subset of what was requested.
          for (const supplied of subsets(requested)) {
            const areas = new Map(
              onPage.map((a) => [a, new Set(supplied)] as const),
            );
            for (const overlays of [[], ["vegetation"]]) {
              const real = attributionLines(
                ctx,
                WIDTH,
                DPI,
                input(terrainCreditLines(new Set(drawn), areas), overlays),
              );
              expect(real.length).toBeLessThanOrEqual(upper.length);
              // A smaller block starts lower on the map (a larger y).
              expect(top(real)).toBeGreaterThanOrEqual(top(upper));
              compared++;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("counts the areas: a page with them prints more lines than one without", () => {
    const requested = new Set(LAYERS);
    expect(upperBoundTerrainLines(requested, AREAS).length).toBeGreaterThan(
      upperBoundTerrainLines(requested, []).length,
    );
    expect(upperBoundTerrainLines(new Set(["slope"]), [])[0]).toContain(
      NSW_5M.credit.slice(NSW_5M.credit.indexOf(" ")),
    );
  });
});
