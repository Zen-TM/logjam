// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PbfWriter } from "pbf";
import {
  computeTileToMapTransform,
  LAND_CLASSES,
  LAND_EDGE_LINES,
  NSW_LAND,
  TILE_SIZE,
} from "@logjam/shared";
import type { Ctx } from "./common";
import { buildLand, drawLand } from "./land";

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
