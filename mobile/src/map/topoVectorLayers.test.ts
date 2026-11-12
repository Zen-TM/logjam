import { describe, expect, it } from "vitest";
import { VECTOR_STYLE_DEFAULTS, zoomFadeIn } from "@logjam/shared";

import { buildTopoVectorLayerDefs } from "./topoVectorLayers";

describe("buildTopoVectorLayerDefs", () => {
  const defs = buildTopoVectorLayerDefs(VECTOR_STYLE_DEFAULTS);

  it("produces minor/major/labels in draw order", () => {
    expect(defs.map((d) => d.suffix)).toEqual(["minor", "major", "labels"]);
  });

  // Mutation: drop a layer's opacity ramp and it pops in at its minzoom.
  it("gates each layer to the shared zooms and fades it in from there", () => {
    const zooms = { minor: 14, labels: 13, major: 12 };
    for (const [suffix, z] of Object.entries(zooms)) {
      const def = defs.find((d) => d.suffix === suffix);
      expect(def?.minzoom).toBe(z);
      expect(
        def?.style[suffix === "labels" ? "textOpacity" : "lineOpacity"],
      ).toEqual(zoomFadeIn(z));
    }
  });

  it("filters major vs minor on 50 m elevation multiples", () => {
    const modExpr = ["%", ["to-number", ["get", "elev"]], 50];
    expect(defs.find((d) => d.suffix === "major")?.filter).toEqual([
      "==",
      modExpr,
      0,
    ]);
    expect(defs.find((d) => d.suffix === "minor")?.filter).toEqual([
      "!=",
      modExpr,
      0,
    ]);
  });

  it("labels follow the major contour colour with line placement", () => {
    const labels = defs.find((d) => d.suffix === "labels");
    expect(labels?.style.symbolPlacement).toBe("line");
    expect(labels?.style.textMaxAngle).toBe(150);
    expect(labels?.style.textColor).toBe(
      // #RRGGBBAA of the defaults' major colour, as rgba() css
      defs.find((d) => d.suffix === "major")?.style.lineColor,
    );
  });
});
