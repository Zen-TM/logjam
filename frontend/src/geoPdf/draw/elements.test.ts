import { describe, expect, it } from "vitest";
import type { GeoPdfConfig } from "@logjam/shared";
import type { Ctx } from "./common";
import { drawCompass, drawGridLabel, drawGridLines } from "./elements";

type Op = {
  op: "line" | "stroke" | "fill";
  text: string;
  x: number;
  y: number;
  colour: string;
  width: number;
};

// Records what is drawn, with the colour and width in force, and a restore
// that undoes what a save kept, as a canvas does.
function recorder() {
  const ops: Op[] = [];
  const saved: { strokeStyle: string; lineWidth: number }[] = [];
  const ctx = {
    font: "",
    strokeStyle: "black",
    fillStyle: "black",
    lineWidth: 1,
    lineJoin: "miter",
    save() {
      saved.push({ strokeStyle: this.strokeStyle, lineWidth: this.lineWidth });
    },
    restore() {
      Object.assign(this, saved.pop());
    },
    measureText: (text: string) => ({ width: text.length * 5 }),
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      ops.push({
        op: "line",
        text: "",
        x: 0,
        y: 0,
        colour: this.strokeStyle,
        width: this.lineWidth,
      });
    },
    strokeText(text: string, x: number, y: number) {
      ops.push({
        op: "stroke",
        text,
        x,
        y,
        colour: this.strokeStyle,
        width: this.lineWidth,
      });
    },
    fillText(text: string, x: number, y: number) {
      ops.push({
        op: "fill",
        text,
        x,
        y,
        colour: this.fillStyle,
        width: 0,
      });
    },
  };
  return { ctx: ctx as unknown as Ctx, ops };
}

/** The labels drawn: each run of text between two grid lines. */
function labels(ops: Op[]): Op[][] {
  const runs: Op[][] = [];
  let open = false;
  for (const op of ops) {
    if (op.op === "line") open = false;
    else {
      if (!open) runs.push([]);
      runs[runs.length - 1]!.push(op);
      open = true;
    }
  }
  return runs;
}

// One label: every piece's halo goes down before any piece's fill (or a halo
// covers its neighbour), and each fill has its own white halo at its place.
// Mutations: halo only the first label; stroke and fill piece by piece; a
// halo of another colour or no width; a fill moved off its halo.
function expectHaloed(label: Op[]) {
  const strokes = label.filter((o) => o.op === "stroke");
  const fills = label.filter((o) => o.op === "fill");
  expect(fills.length).toBeGreaterThan(0);
  expect(strokes).toHaveLength(fills.length);
  const lastStroke = label.map((o) => o.op).lastIndexOf("stroke");
  const firstFill = label.findIndex((o) => o.op === "fill");
  expect(lastStroke).toBeLessThan(firstFill);
  fills.forEach((fill, i) => {
    const halo = strokes[i]!;
    expect([halo.text, halo.x, halo.y]).toEqual([fill.text, fill.x, fill.y]);
    expect(halo.colour).toBe("white");
    expect(halo.width).toBeGreaterThan(0);
  });
}

const extent = { north: -33.6, south: -33.7, east: 150.4, west: 150.3 };
const config = (gridLines: "latlon" | "enNorthing") =>
  ({ extent, scale: 25000, elements: { gridLines } }) as GeoPdfConfig;

describe("grid labels", () => {
  for (const mode of ["latlon", "enNorthing"] as const) {
    it(`${mode}: each label has its own white halo, drawn before its fill`, () => {
      const { ctx, ops } = recorder();
      drawGridLines(ctx, config(mode), 1000, 1000, 150);
      const drawn = labels(ops);
      expect(drawn.length).toBeGreaterThan(2);
      drawn.forEach(expectHaloed);
    });
  }

  // A northern zone's northing is negative south of the equator, and a margin
  // prints no sign. Mutation: revert to the sign-keeping `%` and `Math.floor`,
  // and -10 000 m draws "-1" then "-10".
  it("draws a negative value as unsigned digits", () => {
    const { ctx, ops } = recorder();
    drawGridLabel(ctx, -10000, 10000, 5, 9, 10, 16);
    expect(ops.filter((o) => o.op === "fill").map((o) => o.text)).toEqual([
      "1",
      "90",
    ]);
  });

  it("a label of several pieces strokes all of them before filling any", () => {
    for (const value of [312_000, 477_000]) {
      const { ctx, ops } = recorder();
      drawGridLabel(ctx, value, 1000, 5, 9, 10, 16);
      expect(ops).toHaveLength(6);
      expectHaloed(ops);
    }
  });
});

// A sheet's grid is one grid zone's, the one at its centre, whatever zones its
// corners fall in: read in two zones, the southwest and northeast corners
// differ by hundreds of kilometres (or a 10,000 km false northing) and no
// line falls between them.
// Mutation: read each corner with `toGridAt` (its own zone) and these draw no lines.
describe("a sheet across a grid zone edge", () => {
  const lines = (box: GeoPdfConfig["extent"]) => {
    const { ctx, ops } = recorder();
    drawGridLines(
      ctx,
      {
        extent: box,
        scale: 25000,
        elements: { gridLines: "enNorthing" },
      } as GeoPdfConfig,
      1000,
      1000,
      150,
    );
    return ops.filter((o) => o.op === "line").length;
  };

  it.each([
    [
      "MGA 55 and 56 at 150 E",
      { north: -33.6, south: -33.7, east: 150.05, west: 149.95 },
    ],
    [
      "UTM 32 and 33 at 12 E",
      { north: 46.05, south: 45.95, east: 12.05, west: 11.95 },
    ],
    [
      "the equator, a 10,000 km false northing on one side",
      { north: 0.05, south: -0.05, east: 12.1, west: 12.0 },
    ],
  ])("draws vertical and horizontal lines across %s", (_name, box) => {
    // About 9 km wide and 11 km tall at 1 km spacing.
    expect(lines(box)).toBeGreaterThan(15);
  });
});

// The compass prints the sheet's grid convergence from the zone at its centre.
// A sheet near Sydney is 3 degrees west of MGA zone 56's meridian, so grid
// north is east of true: as before. In Utah (UTM 13) the same offset west of
// the meridian reads west, and south of the equator the sign flips back.
// Mutation: take the zone from the wrong grid (always NSW's) and the Utah and
// UTM 33 figures move.
describe("the compass's grid north", () => {
  const gn = (extent: GeoPdfConfig["extent"]) => {
    const { ctx, ops } = recorder();
    // The compass draws curves and shapes the recorder has no use for.
    const canvas = new Proxy(ctx as unknown as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => {}),
    }) as unknown as Ctx;
    drawCompass(canvas, { extent } as GeoPdfConfig, 0, 10, 150);
    const fills = ops.filter((o) => o.op === "fill").map((o) => o.text);
    // The readout's last row is "GN" and its figure.
    return fills[fills.length - 1];
  };

  it.each([
    [
      "near Sydney",
      { north: -33.6, south: -33.7, east: 150.1, west: 150.0 },
      "1.6° E",
    ],
    [
      "in Utah",
      { north: 37.55, south: 37.45, east: -107.95, west: -108.05 },
      "1.8° W",
    ],
    [
      "south of the equator in UTM 33",
      { north: -10.0, south: -10.1, east: 12.05, west: 11.95 },
      "0.5° E",
    ],
  ])("prints the figure for a sheet %s", (_name, extent, text) => {
    expect(gn(extent)).toBe(text);
  });
});
