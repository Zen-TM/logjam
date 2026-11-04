import { describe, expect, it } from "vitest";
import type { GeoPdfConfig } from "@logjam/shared";
import type { Ctx } from "./common";
import { drawGridLines } from "./elements";

// Records what is drawn and in which strokeStyle, with a restore that undoes
// what a save kept, as a canvas does.
function recorder() {
  const ops: { op: "stroke" | "fill"; text: string; colour: string }[] = [];
  const saved: { strokeStyle: string }[] = [];
  const ctx = {
    font: "",
    strokeStyle: "black",
    fillStyle: "black",
    lineWidth: 1,
    lineJoin: "miter",
    save() {
      saved.push({ strokeStyle: this.strokeStyle });
    },
    restore() {
      this.strokeStyle = saved.pop()!.strokeStyle;
    },
    measureText: (text: string) => ({ width: text.length * 5 }),
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    strokeText(text: string) {
      ops.push({ op: "stroke", text, colour: this.strokeStyle });
    },
    fillText(text: string) {
      ops.push({ op: "fill", text, colour: this.fillStyle });
    },
  };
  return { ctx: ctx as unknown as Ctx, ops };
}

const extent = { north: -33.6, south: -33.7, east: 150.4, west: 150.3 };
const config = (gridLines: "latlon" | "enNorthing") =>
  ({ extent, scale: 25000, elements: { gridLines } }) as GeoPdfConfig;

// Mutation: draw a label with fillText alone, or strokeText it in a colour
// other than white, and this goes red.
describe("grid labels", () => {
  for (const mode of ["latlon", "enNorthing"] as const) {
    it(`${mode} labels each have a white halo drawn before their fill`, () => {
      const { ctx, ops } = recorder();
      drawGridLines(ctx, config(mode), 1000, 1000, 150);
      const fills = ops.filter((o) => o.op === "fill");
      expect(fills.length).toBeGreaterThan(0);
      for (const fill of fills) {
        const halo = ops.findIndex(
          (o) => o.op === "stroke" && o.text === fill.text,
        );
        expect(halo).toBeGreaterThanOrEqual(0);
        expect(halo).toBeLessThan(ops.indexOf(fill));
        expect(ops[halo]!.colour).toBe("white");
      }
    });
  }
});
