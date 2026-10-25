// Pure builder for vector topo overlay layer definitions — the Logjam GPS port of
// Logjam Web's structural layer creation + applyVectorPaint
// (`frontend/src/components/map/Map.tsx`), collapsed into one declarative pass
// (React re-renders on VectorStyleSettings change, so the Logjam Web
// structural/paint split isn't needed here).
//
// Expressions mirror the Logjam Web layer set verbatim; only the font differs
// ("Noto Sans Medium" — the mobile glyph host's stack; Logjam Web uses Open Sans).
// Width/colour/size math comes from @logjam/shared so live map, Logjam Web, and baked
// exports stay in lockstep.
import {
  contourLabelHalo,
  contourWidthStops,
  rgbaCssFromHex,
  type VectorStyleSettings,
} from "@logjam/shared";

import { topoLabelText } from "./mapLabelText";

export type TopoVectorLayerDef = {
  /** Suffix appended to the per-overlay layer id ("minor", "road-label", …). */
  suffix: string;
  type: "line" | "fill" | "symbol";
  sourceLayer: "contours";
  filter?: unknown[];
  minzoom?: number;
  /** MLRN camelCase style object (paint + layout merged). */
  style: Record<string, unknown>;
};

function contourPixelWidth(widthM: number): unknown[] {
  const { z12, z18 } = contourWidthStops(widthM);
  return ["interpolate", ["linear"], ["zoom"], 12, z12, 18, z18];
}

const CONTOUR_MAJOR_FILTER = [
  "==",
  ["%", ["to-number", ["get", "elev"]], 50],
  0,
];
const CONTOUR_MINOR_FILTER = [
  "!=",
  ["%", ["to-number", ["get", "elev"]], 50],
  0,
];

function contourLayerDefs(vs: VectorStyleSettings): TopoVectorLayerDef[] {
  const labelText = topoLabelText(vs.labelScale ?? 1);
  return [
    {
      suffix: "minor",
      type: "line",
      sourceLayer: "contours",
      filter: CONTOUR_MINOR_FILTER,
      minzoom: 14,
      style: {
        lineColor: rgbaCssFromHex(vs.contours.minorColour),
        lineWidth: contourPixelWidth(vs.contours.minorWidthM),
      },
    },
    {
      suffix: "major",
      type: "line",
      sourceLayer: "contours",
      filter: CONTOUR_MAJOR_FILTER,
      style: {
        lineColor: rgbaCssFromHex(vs.contours.majorColour),
        lineWidth: contourPixelWidth(vs.contours.majorWidthM),
      },
    },
    {
      suffix: "labels",
      type: "symbol",
      sourceLayer: "contours",
      filter: CONTOUR_MAJOR_FILTER,
      minzoom: 12,
      style: {
        textField: ["concat", ["to-string", ["get", "elev"]], "m"],
        ...labelText,
        symbolPlacement: "line",
        // LAZ-derived contours are very knobbly — 150° lets labels place
        // along wiggly runs at low zoom (Logjam Web parity, see
        // frontend/src/components/map/Map.tsx).
        textMaxAngle: 150,
        textColor: rgbaCssFromHex(vs.contours.majorColour),
        textHaloColor: contourLabelHalo(vs.contours.majorColour),
        textHaloWidth: 1.5,
      },
    },
  ];
}

/** The statewide contours' layer definitions, styled by `vs`. */
export function buildTopoVectorLayerDefs(
  vs: VectorStyleSettings,
): TopoVectorLayerDef[] {
  return contourLayerDefs(vs);
}
