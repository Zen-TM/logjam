import { describe, expect, it } from "vitest";
import { VECTOR_STYLE_DEFAULTS } from "@logjam/shared";

import { buildTopoVectorLayerDefs } from "./topoVectorLayers";

describe("buildTopoVectorLayerDefs", () => {
  const defs = buildTopoVectorLayerDefs(VECTOR_STYLE_DEFAULTS);

  it("produces minor/major/labels in draw order", () => {
    expect(defs.map((d) => d.suffix)).toEqual(["minor", "major", "labels"]);
  });

  it("gates minor contours to z14+ and labels to z12+", () => {
    expect(defs.find((d) => d.suffix === "minor")?.minzoom).toBe(14);
    expect(defs.find((d) => d.suffix === "labels")?.minzoom).toBe(12);
    expect(defs.find((d) => d.suffix === "major")?.minzoom).toBeUndefined();
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
