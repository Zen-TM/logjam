// Pure builder for vector topo overlay layer definitions — the mobile port of
// web Map.tsx's structural layer creation + applyVectorPaint, collapsed into
// one declarative pass (React re-renders on VectorStyleSettings change, so the
// web's structural/paint split isn't needed here).
//
// Expressions mirror the web layer set verbatim; only the font differs
// ("Noto Sans Medium" — the mobile glyph host's stack; web uses Open Sans).
// Width/colour/size math comes from @logjam/shared so live map, web, and baked
// exports stay in lockstep.
import {
  OSM_POINT_FEATURE_KEYS,
  OSM_POINT_ICON,
  OSM_POINT_ICON_NATURAL_PX,
  contourWidthStops,
  featureLineWidthStops,
  iconTargetPx,
  rgbaCssFromHex,
  type OsmFeatureKey,
  type VectorStyleSettings,
} from "@logjam/shared";

export type TopoVectorLayerDef = {
  /** Suffix appended to the per-overlay layer id ("minor", "road-label", …). */
  suffix: string;
  type: "line" | "fill" | "symbol";
  sourceLayer: "contours" | "features";
  filter?: unknown[];
  minzoom?: number;
  /** MLRN camelCase style object (paint + layout merged). */
  style: Record<string, unknown>;
};

const TEXT_FONT = ["Noto Sans Medium"];

// Base label-size bump matching the web live map (WEB_LABEL_BASE_SCALE — the
// export bakers deliberately diverge with their own larger base).
const LABEL_BASE_SCALE = 1.75;

function labelTextSize(scale: number): unknown[] {
  const s = scale * LABEL_BASE_SCALE;
  return ["interpolate", ["linear"], ["zoom"], 14, 9 * s, 18, 12 * s];
}

function lineWidthInterp(widthZ18: number): unknown[] {
  const { z12, z18 } = featureLineWidthStops(widthZ18);
  return ["interpolate", ["linear"], ["zoom"], 12, z12, 18, z18];
}

function contourPixelWidth(widthM: number): unknown[] {
  const { z12, z18 } = contourWidthStops(widthM);
  return ["interpolate", ["linear"], ["zoom"], 12, z12, 18, z18];
}

function iconSizeInterp(sizeZ18: number): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    12,
    iconTargetPx(sizeZ18, 12) / OSM_POINT_ICON_NATURAL_PX,
    18,
    iconTargetPx(sizeZ18, 18) / OSM_POINT_ICON_NATURAL_PX,
  ];
}

const CONTOUR_MAJOR_FILTER = ["==", ["%", ["to-number", ["get", "elev"]], 50], 0];
const CONTOUR_MINOR_FILTER = ["!=", ["%", ["to-number", ["get", "elev"]], 50], 0];

function contourLayerDefs(vs: VectorStyleSettings): TopoVectorLayerDef[] {
  const sizeExpr = labelTextSize(vs.labelScale ?? 1);
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
        textFont: TEXT_FONT,
        textSize: sizeExpr,
        symbolPlacement: "line",
        // LAZ-derived contours are very knobbly — 150° lets labels place
        // along wiggly runs at low zoom (web parity, see Map.tsx).
        textMaxAngle: 150,
        textColor: rgbaCssFromHex(vs.contours.majorColour),
        textHaloColor: "rgba(255, 255, 255, 0.8)",
        textHaloWidth: 1.5,
      },
    },
  ];
}

function featureLayerDefs(vs: VectorStyleSettings): TopoVectorLayerDef[] {
  const feat = (key: OsmFeatureKey) => vs.features[key];
  const sizeExpr = labelTextSize(vs.labelScale ?? 1);
  const defs: TopoVectorLayerDef[] = [];

  // Line features (waterway/track/road) + power + building fill.
  const lineSpecs: { key: OsmFeatureKey; extra?: Record<string, unknown> }[] = [
    { key: "waterway" },
    { key: "track", extra: { lineDasharray: [4, 2] } },
    { key: "road" },
  ];
  for (const { key, extra } of lineSpecs) {
    if (!feat(key).enabled) continue;
    defs.push({
      suffix: key,
      type: "line",
      sourceLayer: "features",
      filter: ["==", ["get", "_category"], key],
      style: {
        lineColor: rgbaCssFromHex(feat(key).colour),
        lineWidth: lineWidthInterp(feat(key).widthZ18),
        ...extra,
      },
    });
  }
  if (feat("power").enabled) {
    defs.push({
      suffix: "power",
      type: "line",
      sourceLayer: "features",
      filter: ["==", ["get", "_category"], "power"],
      style: {
        // Raw pixel width (no zoom interpolation) — web parity.
        lineColor: rgbaCssFromHex(feat("power").colour),
        lineWidth: feat("power").widthZ18,
        lineDasharray: [3, 4],
      },
    });
  }
  if (feat("building").enabled) {
    const colour = rgbaCssFromHex(feat("building").colour);
    defs.push({
      suffix: "building",
      type: "fill",
      sourceLayer: "features",
      filter: ["==", ["get", "_category"], "building"],
      style: { fillColor: colour, fillOutlineColor: colour },
    });
  }

  // Line-feature name labels — label colour follows the line colour.
  const lineLabelSpecs: { key: "waterway" | "track" | "road"; filter: unknown[] }[] = [
    {
      key: "waterway",
      filter: ["all", ["==", ["get", "_category"], "waterway"], ["has", "name"]],
    },
    {
      key: "track",
      filter: ["all", ["==", ["get", "_category"], "track"], ["has", "name"]],
    },
    {
      key: "road",
      filter: [
        "all",
        ["==", ["get", "_category"], "road"],
        ["any", ["has", "name"], ["has", "ref"]],
      ],
    },
  ];
  for (const { key, filter } of lineLabelSpecs) {
    if (!feat(key).enabled) continue;
    defs.push({
      suffix: `${key}-label`,
      type: "symbol",
      sourceLayer: "features",
      filter,
      minzoom: 12,
      style: {
        textField: ["coalesce", ["get", "name"], ["get", "ref"], ""],
        textFont: TEXT_FONT,
        textSize: sizeExpr,
        symbolPlacement: "line",
        textMaxAngle: 60,
        textColor: rgbaCssFromHex(feat(key).colour),
        textHaloColor: "rgba(255,255,255,0.8)",
        textHaloWidth: 1.5,
      },
    });
  }

  // Point features → fixed PNG icons (registered app-side via <Images>),
  // then name labels (peaks also show elevation).
  for (const key of OSM_POINT_FEATURE_KEYS) {
    if (!feat(key).enabled) continue;
    defs.push({
      suffix: key,
      type: "symbol",
      sourceLayer: "features",
      filter: ["==", ["get", "_category"], key],
      minzoom: key === "gate" ? 12 : 10,
      style: {
        iconImage: `topo-icon-${key}`,
        iconSize: iconSizeInterp(OSM_POINT_ICON[key].sizeZ18),
        iconAllowOverlap: true,
      },
    });
  }
  for (const key of OSM_POINT_FEATURE_KEYS) {
    if (!feat(key).enabled) continue;
    const textField =
      key === "peak"
        ? [
            "case",
            ["all", ["has", "name"], ["has", "ele"]],
            ["concat", ["get", "name"], "\n", ["to-string", ["get", "ele"]], " m"],
            ["has", "name"],
            ["get", "name"],
            ["has", "ele"],
            ["concat", ["to-string", ["get", "ele"]], " m"],
            "",
          ]
        : ["coalesce", ["get", "name"], ""];
    defs.push({
      suffix: `${key}-label`,
      type: "symbol",
      sourceLayer: "features",
      filter: ["==", ["get", "_category"], key],
      minzoom: 12,
      style: {
        textField,
        textFont: TEXT_FONT,
        textSize: sizeExpr,
        textAnchor: "top",
        textOffset: [0, 0.8],
        textOptional: true,
        textColor: rgbaCssFromHex(feat(key).colour),
        textHaloColor: "rgba(255,255,255,0.85)",
        textHaloWidth: 1.5,
      },
    });
  }

  return defs;
}

/**
 * Layer definitions for one vector topo overlay. `kind` is derived from the
 * layer name ("contours" ⇒ contour styling, anything else ⇒ OSM features —
 * matches the web's `id.includes("contours")` test).
 */
export function buildTopoVectorLayerDefs(
  kind: "contours" | "features",
  vs: VectorStyleSettings,
): TopoVectorLayerDef[] {
  return kind === "contours" ? contourLayerDefs(vs) : featureLayerDefs(vs);
}
