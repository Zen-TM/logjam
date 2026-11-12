import { describe, expect, it } from "vitest";
import { PbfWriter } from "pbf";
import type { TileToMapTransform } from "@logjam/shared";
import {
  BASEMAP_BANDS,
  buildBasemap,
  drawBasemapBand,
  drawBasemapLabels,
  type BasemapTile,
} from "./basemap";
import type { Ctx } from "./common";

const EXTENT = 4096;
const zig = (v: number) => (v << 1) ^ (v >> 31);

type Feature = {
  layer: string;
  type: 1 | 2 | 3;
  geometry: number[];
  tags?: Record<string, string>;
};

const point = (x: number, y: number) => [(1 << 3) | 1, zig(x), zig(y)];
const line = (x0: number, y0: number, x1: number, y1: number) => [
  (1 << 3) | 1,
  zig(x0),
  zig(y0),
  (1 << 3) | 2,
  zig(x1 - x0),
  zig(y1 - y0),
];
const square = (a: number, b: number) => [
  (1 << 3) | 1,
  zig(a),
  zig(a),
  (3 << 3) | 2,
  zig(b - a),
  0,
  0,
  zig(b - a),
  zig(a - b),
  0,
  (1 << 3) | 7,
];

function mvt(features: Feature[]): ArrayBuffer {
  const pbf = new PbfWriter();
  for (const name of new Set(features.map((f) => f.layer))) {
    const mine = features.filter((f) => f.layer === name);
    pbf.writeMessage(
      3,
      (_: unknown, layer: PbfWriter) => {
        layer.writeStringField(1, name);
        const keys = [
          ...new Set(mine.flatMap((f) => Object.keys(f.tags ?? {}))),
        ];
        const values = [
          ...new Set(mine.flatMap((f) => Object.values(f.tags ?? {}))),
        ];
        for (const f of mine)
          layer.writeMessage(
            2,
            (_f: unknown, out: PbfWriter) => {
              out.writePackedVarint(
                2,
                Object.entries(f.tags ?? {}).flatMap(([k, v]) => [
                  keys.indexOf(k),
                  values.indexOf(v),
                ]),
              );
              out.writeVarintField(3, f.type);
              out.writePackedVarint(4, f.geometry);
            },
            null,
          );
        for (const k of keys) layer.writeStringField(3, k);
        for (const v of values)
          layer.writeMessage(
            4,
            (_v: unknown, out: PbfWriter) => out.writeStringField(1, v),
            null,
          );
        layer.writeVarintField(5, EXTENT);
        layer.writeVarintField(15, 2);
      },
      null,
    );
  }
  const bytes = pbf.finish();
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

const transform = {
  minTileX: 0,
  minTileY: 0,
  offsetX: 0,
  offsetY: 0,
  scaleX: 4,
  scaleY: 4,
} as TileToMapTransform;
const SIZE = 1024;

/** A context that records what reaches the page. */
function recorder() {
  const drawn: { op: string; style: string; text?: string; angle?: number }[] =
    [];
  let angle = 0;
  const ctx = {
    canvas: { width: SIZE },
    measureText: (text: string) => ({ width: text.length * 10 }),
    save() {},
    restore() {
      angle = 0;
    },
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    setLineDash() {},
    translate() {},
    rotate(a: number) {
      angle = a;
    },
    fill() {
      drawn.push({ op: "fill", style: String(ctx.fillStyle) });
    },
    stroke() {
      drawn.push({ op: "stroke", style: String(ctx.strokeStyle) });
    },
    fillRect() {
      drawn.push({ op: "background", style: String(ctx.fillStyle) });
    },
    fillText(text: string) {
      drawn.push({ op: "text", style: "", text, angle });
    },
    strokeText() {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
  };
  return { ctx: ctx as unknown as Ctx, drawn };
}

const build = (tiles: BasemapTile[], zoom = 14) =>
  buildBasemap(
    tiles,
    transform,
    zoom,
    1,
    { width: SIZE, height: SIZE },
    recorder().ctx,
  );

const tile = (features: Feature[]): BasemapTile => ({
  x: 0,
  y: 0,
  data: mvt(features),
});

const earth: Feature = { layer: "earth", type: 3, geometry: square(0, 4096) };
const lake: Feature = { layer: "water", type: 3, geometry: square(100, 200) };
const highway: Feature = {
  layer: "roads",
  type: 2,
  geometry: line(0, 500, 4000, 500),
  tags: { kind: "highway", "pmap:level": "0" },
};

const place = (name: string, x: number, y: number): Feature => ({
  layer: "places",
  type: 1,
  geometry: point(x, y),
  tags: { kind: "locality", name, "name:en": name, min_zoom: "1" },
});

describe("buildBasemap's bands", () => {
  const drawing = build([tile([earth, lake, highway])]);
  const inBand = (band: number) => {
    const { ctx, drawn } = recorder();
    drawBasemapBand(ctx, drawing, band, 0, SIZE);
    return drawn;
  };

  // Mutation: put every layer in band 0, and the terrain is drawn over the
  // roads and the water, unlike the map.
  it("keeps land below the hillshade, water below the slope and roads over both", () => {
    expect(inBand(0).map((d) => d.op)).toEqual(["background", "fill"]);
    expect(inBand(1).map((d) => d.op)).toEqual(["fill"]);
    expect(inBand(2).some((d) => d.op === "stroke")).toBe(true);
    expect(BASEMAP_BANDS).toBe(3);
  });

  it("draws nothing for a tile off the rows asked for", () => {
    const { ctx, drawn } = recorder();
    drawBasemapBand(ctx, drawing, 1, SIZE + 100, SIZE + 200);
    expect(drawn).toEqual([]);
  });
});

describe("buildBasemap's labels", () => {
  const texts = (features: Feature[]) => {
    const { ctx, drawn } = recorder();
    drawBasemapLabels(ctx, build([tile(features)]), 0, SIZE);
    return drawn.filter((d) => d.op === "text");
  };

  // Mutation: drop the `taken` check, and names print over each other.
  it("keeps the first of two labels that collide", () => {
    expect(
      texts([place("Alpha", 1000, 1000), place("Bravo", 1010, 1010)]).map(
        (t) => t.text,
      ),
    ).toEqual(["Alpha"]);
  });

  it("draws both when they are clear of each other", () => {
    expect(
      texts([place("Alpha", 1000, 1000), place("Bravo", 3000, 3000)]).length,
    ).toBe(2);
  });

  // Mutation: test the anchor rather than the box, and half a name prints.
  it("leaves off a label the map's edge would cut", () => {
    expect(texts([place("Alpha", 1, 1000)])).toEqual([]);
  });

  // Mutation: drop the `NEEDS_SPRITE` check, and a bare road number prints.
  it("leaves off a road's shield, which has no sprite here", () => {
    expect(
      texts([{ ...highway, tags: { kind: "highway", shield_text: "A32" } }]),
    ).toEqual([]);
  });

  it("does not label a line too short for its text", () => {
    const road: Feature = {
      layer: "roads",
      type: 2,
      geometry: line(1000, 1000, 1001, 1001),
      tags: {
        kind: "minor_road",
        name: "Madeup Road",
        "name:en": "Madeup Road",
      },
    };
    const { ctx, drawn } = recorder();
    drawBasemapLabels(ctx, build([tile([road])], 15.5), 0, SIZE);
    expect(drawn).toEqual([]);
  });
});

describe("a tile that will not decode", () => {
  // Mutation: count the tiles asked for, and a failed read prints a blank map.
  it("is not counted as drawn", () => {
    const bad = new Uint8Array([255, 255, 255, 255]).buffer as ArrayBuffer;
    expect(build([{ x: 0, y: 0, data: bad }]).tilesDrawn).toBe(0);
  });
});
