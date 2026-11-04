import { describe, expect, it } from "vitest";
import type { GeoPdfConfig } from "@logjam/shared";
import type { Ctx } from "./common";
import { drawGridLabel, drawGridLines } from "./elements";

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

  it("a label of several pieces strokes all of them before filling any", () => {
    for (const value of [312_000, 477_000]) {
      const { ctx, ops } = recorder();
      drawGridLabel(ctx, value, 1000, 5, 9, 10, 16);
      expect(ops).toHaveLength(6);
      expectHaloed(ops);
    }
  });
});
