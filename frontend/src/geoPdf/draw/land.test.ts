// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PbfWriter } from "pbf";
import {
  computeTileToMapTransform,
  LAND_CLASSES,
  LAND_EDGE_LINES,
  MAP_TERRAIN,
  NSW_LAND,
  TILE_SIZE,
} from "@logjam/shared";
import type { Ctx } from "./common";
import {
  buildLand,
  drawLand,
  drawLandLegend,
  landClassesDrawn,
  type LandShape,
} from "./land";

const zig = (v: number) => (v << 1) ^ (v >> 31);

/** One made-up square covering the tile, of one class. */
function squareTile(tenure: string): Uint8Array {
  const tile = new PbfWriter();
  tile.writeMessage(
    3,
    (_o, layer) => {
      layer.writeStringField(1, NSW_LAND.sourceLayer);
      layer.writeMessage(
        2,
        (_f, pbf) => {
          pbf.writePackedVarint(2, [0, 0]);
          pbf.writeVarintField(3, 3);
          const g = [(1 << 3) | 1, zig(0), zig(0), (3 << 3) | 2];
          g.push(zig(4096), zig(0), zig(0), zig(4096), zig(-4096), zig(0));
          g.push((1 << 3) | 7);
          pbf.writePackedVarint(4, g);
        },
        null,
      );
      layer.writeStringField(3, NSW_LAND.classProperty);
      layer.writeMessage(4, (_v, pbf) => pbf.writeStringField(1, tenure), null);
      layer.writeVarintField(5, 4096);
      layer.writeVarintField(15, 2);
    },
    null,
  );
  return tile.finish();
}

// Made-up: a box over two z13 tiles.
const t = computeTileToMapTransform(13, -29.9, -30.1, 150.1, 149.9, 800, 800);
const at = (dx: number, tenure: string) => ({
  x: t.minTileX + dx,
  y: t.minTileY,
  data: squareTile(tenure),
});

describe("buildLand", () => {
  // Mutation: read the colour from anything but the class, and a print's
  // borders stop matching the map's legend.
  it("colours a tile's borders by its class", () => {
    const [shape] = buildLand([at(0, "Private")], t);
    expect(shape!.color).toBe(LAND_CLASSES[0].colour);
    expect(shape!.rings).toHaveLength(1);
  });

  // Mutation: drop the class test, and an unknown class prints with no
  // legend entry to read it by.
  it("leaves out a class it doesn't know, and a tile that won't decode", () => {
    expect(buildLand([at(0, "Unknown")], t)).toEqual([]);
    const garbage = { x: 0, y: 0, data: new Uint8Array([255, 255, 255]) };
    expect(buildLand([garbage], t)).toEqual([]);
  });

  // Mutation: round neither edge, and neighbours overlap by a fraction of a
  // pixel, which doubles a border where it crosses the join.
  it("gives neighbouring tiles exactly one shared edge", () => {
    const [a, b] = buildLand([at(0, "Private"), at(1, "Private")], t);
    expect(a!.clip.right).toBe(b!.clip.left);
    expect(Number.isInteger(a!.clip.right)).toBe(true);
    expect(a!.clip.right - a!.clip.left).toBeCloseTo(
      TILE_SIZE * t.scaleX,
      -0.4,
    );
  });
});

describe("drawLand", () => {
  // Mutation: skip the strip test, and every strip repaints the whole print.
  it("draws only the tiles that reach the strip", () => {
    const shapes = buildLand([at(0, "Private")], t);
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
    };
    const { top, bottom } = shapes[0]!.clip;
    drawLand(ctx as unknown as Ctx, shapes, bottom + 1, bottom + 100);
    expect(ctx.stroke).not.toHaveBeenCalled();
    drawLand(ctx as unknown as Ctx, shapes, top, bottom);
    expect(ctx.stroke).toHaveBeenCalledTimes(LAND_EDGE_LINES.length);
    expect(ctx.clip).toHaveBeenCalledTimes(2);
  });

  // Mutation: stroke before clipping to the holding, and each border's colour
  // spills into its neighbour's side, which a map's never does.
  it("strokes every border line inside its own holding", () => {
    const calls: string[] = [];
    const log = (name: string) => () => calls.push(name);
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      clip: (rule?: string) => calls.push(`clip ${rule ?? "tile"}`),
      stroke: log("stroke"),
    };
    const shapes = buildLand([at(0, "Private")], t);
    drawLand(ctx as unknown as Ctx, shapes, 0, 800);
    expect(calls).toEqual([
      "clip tile",
      "clip evenodd",
      ...LAND_EDGE_LINES.map(() => "stroke"),
    ]);
  });
});

describe("landClassesDrawn", () => {
  const square = { left: 0, top: 0, right: 100, bottom: 100 };
  const shape = (colour: string, ring: number[], clip = square): LandShape => ({
    color: colour,
    pixel: 1,
    clip,
    rings: [Float64Array.from(ring)],
  });
  const [first, second, third] = LAND_CLASSES;

  // Mutation: list the classes in the order the tiles came, and two prints of
  // one area read in a different order.
  it("lists the classes with a border on the sheet, in the legend's order", () => {
    const shapes = [
      shape(second.colour, [10, 10, 90, 10, 90, 90]),
      shape(first.colour, [20, 20, 80, 20, 80, 80]),
    ];
    expect(landClassesDrawn(shapes, 100, 100)).toEqual([first, second]);
  });

  // Mutation: test the ring against the whole tile, and a print lists a class
  // that's only in the part of the tile off the sheet.
  it("leaves out a class whose border is off the sheet", () => {
    const shapes = [shape(first.colour, [60, 60, 90, 60, 90, 90])];
    expect(landClassesDrawn(shapes, 50, 50)).toEqual([]);
  });

  // Mutation: test the ring against the sheet alone, and every class in a
  // tile's margin is listed for an edge that is only where the tile was cut.
  it("doesn't take the edge a tile was cut at for a border", () => {
    const cut = [-5, -5, 105, -5, 105, 105, -5, 105];
    expect(landClassesDrawn([shape(third.colour, cut)], 300, 300)).toEqual([]);
  });

  // Mutation: test vertices alone, and a long straight border across the
  // sheet explains nothing.
  it("finds a border that crosses the sheet with no vertex on it", () => {
    const across = [-500, 50, 500, 50, 500, 600, -500, 600];
    expect(landClassesDrawn([shape(first.colour, across)], 100, 100)).toEqual([
      first,
    ]);
  });
});

describe("drawLandLegend", () => {
  const legendCtx = () => ({
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 40 }),
  });

  // Mutation: draw the panel regardless, and a print with no border carries an
  // empty box over the map.
  it("draws nothing with no class to explain", () => {
    const ctx = legendCtx();
    const next = drawLandLegend(ctx as unknown as Ctx, [], 500, 10, 4, 3, 96);
    expect(next).toBe(500);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  // Mutation: name a row by anything but its class, and the colours say nothing.
  it("names each class beside its colour, and stacks above stackY", () => {
    const ctx = legendCtx();
    const classes = LAND_CLASSES.slice(0, 2);
    const next = drawLandLegend(
      ctx as unknown as Ctx,
      classes,
      500,
      10,
      4,
      3,
      96,
    );
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual([
      MAP_TERRAIN.copy.land,
      ...classes.map((c) => c.name),
    ]);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(next).toBeLessThan(500);
  });
});
