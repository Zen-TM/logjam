import { describe, expect, it } from "vitest";
import {
  OSM_POINT_FEATURE_KEYS,
  VECTOR_STYLE_DEFAULTS,
  cloneVectorStyleSettings,
} from "@logjam/shared";

import { buildTopoVectorLayerDefs } from "./topoVectorLayers";

describe("buildTopoVectorLayerDefs — contours", () => {
  const defs = buildTopoVectorLayerDefs("contours", VECTOR_STYLE_DEFAULTS);

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

describe("buildTopoVectorLayerDefs — features", () => {
  it("emits lines, building fill, line labels, icons, point labels for enabled categories", () => {
    const defs = buildTopoVectorLayerDefs("features", VECTOR_STYLE_DEFAULTS);
    const suffixes = defs.map((d) => d.suffix);
    for (const expected of ["waterway", "track", "road", "power", "building"]) {
      expect(suffixes).toContain(expected);
    }
    expect(suffixes).toContain("waterway-label");
    // Defaults enable campsite/peak/spring/gate/cave points.
    expect(suffixes).toContain("peak");
    expect(suffixes).toContain("peak-label");
  });

  it("omits every layer of a disabled category", () => {
    const vs = cloneVectorStyleSettings(VECTOR_STYLE_DEFAULTS);
    vs.features.road.enabled = false;
    vs.features.peak.enabled = false;
    const suffixes = buildTopoVectorLayerDefs("features", vs).map((d) => d.suffix);
    expect(suffixes).not.toContain("road");
    expect(suffixes).not.toContain("road-label");
    expect(suffixes).not.toContain("peak");
    expect(suffixes).not.toContain("peak-label");
  });

  it("only emits point layers for categories enabled in the style", () => {
    const vs = cloneVectorStyleSettings(VECTOR_STYLE_DEFAULTS);
    const defs = buildTopoVectorLayerDefs("features", vs);
    for (const key of OSM_POINT_FEATURE_KEYS) {
      const present = defs.some((d) => d.suffix === key);
      expect(present).toBe(vs.features[key].enabled);
    }
  });

  it("labels inherit their category colour", () => {
    const defs = buildTopoVectorLayerDefs("features", VECTOR_STYLE_DEFAULTS);
    const track = defs.find((d) => d.suffix === "track");
    const trackLabel = defs.find((d) => d.suffix === "track-label");
    expect(trackLabel?.style.textColor).toBe(track?.style.lineColor);
  });

  it("peak labels concatenate name and elevation", () => {
    const defs = buildTopoVectorLayerDefs("features", VECTOR_STYLE_DEFAULTS);
    const peakLabel = defs.find((d) => d.suffix === "peak-label");
    expect(JSON.stringify(peakLabel?.style.textField)).toContain("ele");
  });

  it("labelScale scales the text-size ramp linearly", () => {
    const vs = cloneVectorStyleSettings(VECTOR_STYLE_DEFAULTS);
    vs.labelScale = 2;
    const base = buildTopoVectorLayerDefs("features", VECTOR_STYLE_DEFAULTS);
    const scaled = buildTopoVectorLayerDefs("features", vs);
    const sizeOf = (defs: typeof base) =>
      defs.find((d) => d.suffix === "waterway-label")?.style.textSize as number[];
    // ["interpolate",["linear"],["zoom"], 14, <size@14>, 18, <size@18>]
    expect(sizeOf(scaled)[4]).toBeCloseTo((sizeOf(base)[4] as number) * 2);
  });

  it("power uses a raw pixel width, not a zoom ramp", () => {
    const defs = buildTopoVectorLayerDefs("features", VECTOR_STYLE_DEFAULTS);
    expect(typeof defs.find((d) => d.suffix === "power")?.style.lineWidth).toBe(
      "number",
    );
  });
});
