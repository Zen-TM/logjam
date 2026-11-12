// OSM Vector on the map image: the style the map draws (`addProtomapsBasemap`
// in Map.tsx), read by MapLibre's own expression evaluator and painted with
// Canvas2D, because a print is drawn in a worker at print resolution where
// MapLibre cannot run (ADR 0043).
//
// Like the contours, everything is decoded and every label placed once, over
// the whole map, before the first strip; a strip only strokes what reaches it.
// Guard: e2e/geopdf-render.spec.ts compares a multi-strip render with a
// one-strip one.
//
// Sizes are the style's CSS pixels at STYLE_DPI, as for the contours.
// ponytail: labels sit straight on a line and use the print's one font, and the
// style's sprite icons are left out; bend them along the line or fetch the
// sprite if a print reads worse for it.
import {
  featureFilter,
  latest,
  normalizePropertyExpression,
  type FilterSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { layers, namedFlavor } from "@protomaps/basemaps";
import {
  TERRAIN_BASEMAP_ANCHORS,
  TILE_SIZE,
  type TileToMapTransform,
} from "@logjam/shared";
import { MAP_FONT, type Ctx } from "./common";
import { reachesRows, tileRect, type TileRect } from "./tiles";

type StyleLayer = ReturnType<typeof layers>[number];
type Group = "paint" | "layout";
type Evaluate = (feature?: VectorTileFeature) => unknown;

const STYLE = layers("protomaps", namedFlavor("light"), { lang: "en" });

/** A road's number means nothing without the shield its sprite draws round it. */
const NEEDS_SPRITE = new Set(["roads_shields"]);
/** MapLibre's own default gap between repeats of a line's label, in style px. */
const LABEL_REPEAT_PX = 250;
/** MapLibre's default `text-padding`, the clear space round a label. */
const LABEL_PADDING_PX = 2;
const LINE_HEIGHT_EM = 1.2;

/** The bands terrain interleaves with (TERRAIN_BASEMAP_ANCHORS), in draw order. */
export const BASEMAP_BANDS = 3;

function bandOf(index: number): number {
  const before = (id: string) => STYLE.findIndex((l) => l.id === id);
  if (index < before(TERRAIN_BASEMAP_ANCHORS.hillshade)) return 0;
  return index < before(TERRAIN_BASEMAP_ANCHORS.slope) ? 1 : 2;
}

type Ink = {
  fill: boolean;
  color: string;
  opacity: number;
  width: number;
  dash: number[];
  rings: Float64Array[];
};
type Paint = { band: number; rect: TileRect; inks: Ink[] };
type Label = {
  x: number;
  y: number;
  angle: number;
  lines: string[];
  font: string;
  lineHeight: number;
  letterSpacing: number;
  color: string;
  halo: string;
  haloWidth: number;
  /** Half the box's height once turned, halo included. */
  reach: number;
};

export type BasemapDrawing = {
  background: string;
  widthPx: number;
  paints: Paint[];
  labels: Label[];
  /** Tiles that decoded: none is a failed read, not an empty map. */
  tilesDrawn: number;
};

export type BasemapTile = { x: number; y: number; data: ArrayBuffer };

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Evaluators for a layer's property, at this zoom. */
function evaluator(layer: StyleLayer, zoom: number) {
  return (group: Group, name: string): Evaluate => {
    const spec = (latest as unknown as Record<string, Record<string, never>>)[
      `${group}_${layer.type}`
    ]![name]! as { default?: unknown };
    const own = (layer as unknown as Record<Group, Record<string, unknown>>)[
      group
    ]?.[name];
    const value = own ?? spec.default;
    if (value === undefined) return () => undefined;
    const expression = normalizePropertyExpression(
      value as never,
      layer.id,
      spec as never,
    );
    return (feature) => expression.evaluate({ zoom }, feature as never);
  };
}

const inZoom = (layer: StyleLayer, zoom: number) =>
  zoom >= (layer.minzoom ?? 0) && zoom < (layer.maxzoom ?? Infinity);

function decode(data: ArrayBuffer) {
  const tile = new VectorTile(new PbfReader(data));
  const features = new Map<string, VectorTileFeature[]>();
  for (const [name, layer] of Object.entries(tile.layers)) {
    const list: VectorTileFeature[] = [];
    for (let i = 0; i < layer.length; i++) list.push(layer.feature(i));
    features.set(name, list);
  }
  return features;
}

/** Decode the tiles and place the labels, for `drawBasemapBand` and `drawBasemapLabels`. */
export function buildBasemap(
  tiles: readonly BasemapTile[],
  transform: TileToMapTransform,
  styleZoom: number,
  pxScale: number,
  mapPx: { width: number; height: number },
  measure: Ctx,
): BasemapDrawing {
  const ordered = [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
  const decoded = ordered.flatMap((tile) => {
    try {
      return [{ tile, features: decode(tile.data) }];
    } catch {
      return [];
    }
  });

  /** The feature's rings on the map image, shared by every layer that draws it. */
  const placed = new Map<VectorTileFeature, Float64Array[]>();
  const ringsOf = (feature: VectorTileFeature, tile: BasemapTile) => {
    let rings = placed.get(feature);
    if (rings) return rings;
    const dx =
      ((tile.x - transform.minTileX) * TILE_SIZE - transform.offsetX) *
      transform.scaleX;
    const dy =
      ((tile.y - transform.minTileY) * TILE_SIZE - transform.offsetY) *
      transform.scaleY;
    const sx = (TILE_SIZE / feature.extent) * transform.scaleX;
    const sy = (TILE_SIZE / feature.extent) * transform.scaleY;
    rings = feature.loadGeometry().map((ring) => {
      const pts = new Float64Array(ring.length * 2);
      ring.forEach((p, i) => {
        pts[i * 2] = dx + p.x * sx;
        pts[i * 2 + 1] = dy + p.y * sy;
      });
      return pts;
    });
    placed.set(feature, rings);
    return rings;
  };

  let background = "#ffffff";
  const paints: Paint[] = [];
  STYLE.forEach((layer, index) => {
    if (!inZoom(layer, styleZoom)) return;
    const prop = evaluator(layer, styleZoom);
    if (layer.type === "background") {
      background = String(prop("paint", "background-color")());
      return;
    }
    if (layer.type !== "fill" && layer.type !== "line") return;
    const fill = layer.type === "fill";
    const color = prop("paint", `${layer.type}-color`);
    const opacity = prop("paint", `${layer.type}-opacity`);
    const width = fill ? null : prop("paint", "line-width");
    const gap = fill ? null : prop("paint", "line-gap-width");
    const dash = fill ? null : prop("paint", "line-dasharray");
    const filter = featureFilter(
      layer.filter as FilterSpecification | undefined,
      layer.id,
    );
    const sourceLayer = layer["source-layer"];
    if (!sourceLayer) return;
    for (const { tile, features } of decoded) {
      const inks = new Map<string, Ink>();
      for (const feature of features.get(sourceLayer) ?? []) {
        if (!filter.filter({ zoom: styleZoom }, feature as never)) continue;
        const lineWidth = (width?.(feature) as number | undefined) ?? 0;
        // A casing is two lines either side of a gap the road's own layer then
        // fills, so one stroke the width of all three looks the same.
        const gapWidth = (gap?.(feature) as number | undefined) ?? 0;
        const stroke = gapWidth > 0 ? gapWidth + 2 * lineWidth : lineWidth;
        if (!fill && stroke <= 0) continue;
        const dashes = (dash?.(feature) as number[] | undefined) ?? [];
        const c = String(color(feature));
        const o = (opacity(feature) as number | undefined) ?? 1;
        const key = `${c} ${o} ${stroke} ${dashes.join()}`;
        let ink = inks.get(key);
        if (!ink) {
          ink = {
            fill,
            color: c,
            opacity: o,
            width: stroke * pxScale,
            dash: dashes.map((d) => d * lineWidth * pxScale),
            rings: [],
          };
          inks.set(key, ink);
        }
        ink.rings.push(...ringsOf(feature, tile));
      }
      if (inks.size === 0) continue;
      paints.push({
        band: bandOf(index),
        rect: tileRect({ z: 0, ...tile }, transform),
        inks: [...inks.values()],
      });
    }
  });

  return {
    background,
    widthPx: mapPx.width,
    paints,
    labels: placeLabels(decoded, ringsOf, styleZoom, pxScale, mapPx, measure),
    tilesDrawn: decoded.length,
  };
}

function placeLabels(
  decoded: readonly {
    tile: BasemapTile;
    features: Map<string, VectorTileFeature[]>;
  }[],
  ringsOf: (feature: VectorTileFeature, tile: BasemapTile) => Float64Array[],
  styleZoom: number,
  pxScale: number,
  mapPx: { width: number; height: number },
  measure: Ctx,
): Label[] {
  const labels: Label[] = [];
  const taken: Box[] = [];
  const repeats = new Map<string, { x: number; y: number }[]>();
  const repeatPx = LABEL_REPEAT_PX * pxScale;

  // Top of the style first, as MapLibre places: a place name beats a road's.
  for (const layer of [...STYLE].reverse()) {
    if (layer.type !== "symbol" || NEEDS_SPRITE.has(layer.id)) continue;
    if (!inZoom(layer, styleZoom) || !layer.layout?.["text-field"]) continue;
    const sourceLayer = layer["source-layer"];
    if (!sourceLayer) continue;
    const prop = evaluator(layer, styleZoom);
    const filter = featureFilter(
      layer.filter as FilterSpecification | undefined,
      layer.id,
    );
    const onLine = prop("layout", "symbol-placement")() !== "point";
    const sortKey = prop("layout", "symbol-sort-key");
    const candidates = decoded
      .flatMap(({ tile, features }) =>
        (features.get(sourceLayer) ?? [])
          .filter((f) => filter.filter({ zoom: styleZoom }, f as never))
          .map((feature) => ({ tile, feature })),
      )
      .map((c) => ({ ...c, key: (sortKey(c.feature) as number) ?? 0 }))
      .sort((a, b) => a.key - b.key);

    for (const { tile, feature } of candidates) {
      const raw = String(prop("layout", "text-field")(feature) ?? "").trim();
      if (!raw) continue;
      const upper = prop("layout", "text-transform")(feature) === "uppercase";
      const lines = raw
        .split("\n")
        .map((l) => (upper ? l.toUpperCase() : l).trim())
        .filter(Boolean);
      const sizePx = (prop("layout", "text-size")(feature) as number) * pxScale;
      const face = ((prop("layout", "text-font")(feature) as string[]) ??
        [])[0];
      const font = `${face?.includes("Italic") ? "italic " : ""}${
        face && /Medium|Semi|Bold/.test(face) ? "bold " : ""
      }${sizePx}px ${MAP_FONT}`;
      const letterSpacing =
        ((prop("layout", "text-letter-spacing")(feature) as number) ?? 0) *
        sizePx;
      measure.font = font;
      const widthPx = Math.max(
        ...lines.map(
          (l) => measure.measureText(l).width + l.length * letterSpacing,
        ),
      );
      const lineHeight = sizePx * LINE_HEIGHT_EM;
      const heightPx = lines.length * lineHeight;

      const at = onLine
        ? lineAnchor(ringsOf(feature, tile), widthPx)
        : pointAnchor(ringsOf(feature, tile));
      if (!at) continue;
      const seen = repeats.get(raw) ?? [];
      if (
        onLine &&
        seen.some((p) => Math.hypot(p.x - at.x, p.y - at.y) < repeatPx)
      )
        continue;

      const haloWidth =
        ((prop("paint", "text-halo-width")(feature) as number) ?? 0) * pxScale;
      const padding = LABEL_PADDING_PX * pxScale;
      const cos = Math.abs(Math.cos(at.angle));
      const sin = Math.abs(Math.sin(at.angle));
      const halfW = (cos * widthPx + sin * heightPx) / 2 + haloWidth + padding;
      const halfH = (sin * widthPx + cos * heightPx) / 2 + haloWidth + padding;
      const box = {
        x0: at.x - halfW,
        y0: at.y - halfH,
        x1: at.x + halfW,
        y1: at.y + halfH,
      };
      // A name cut by the sheet's edge reads as a different name.
      if (
        box.x0 < 0 ||
        box.y0 < 0 ||
        box.x1 > mapPx.width ||
        box.y1 > mapPx.height
      )
        continue;
      // ponytail: O(n²) in the labels of one print, a few thousand at worst;
      // a grid if a city at A2 ever shows up in `timings`.
      if (taken.some((other) => overlaps(box, other))) continue;
      taken.push(box);
      if (onLine) repeats.set(raw, [...seen, at]);
      labels.push({
        ...at,
        lines,
        font,
        lineHeight,
        letterSpacing,
        color: String(prop("paint", "text-color")(feature)),
        halo: String(prop("paint", "text-halo-color")(feature)),
        haloWidth,
        reach: halfH,
      });
    }
  }
  return labels;
}

function pointAnchor(rings: readonly Float64Array[]) {
  const pts = rings[0];
  return pts && pts.length >= 2 ? { x: pts[0]!, y: pts[1]!, angle: 0 } : null;
}

/** The middle of the longest line, if the text fits on it, turned to read upright. */
function lineAnchor(rings: readonly Float64Array[], textPx: number) {
  let best: Float64Array | null = null;
  let bestLength = 0;
  for (const pts of rings) {
    let length = 0;
    for (let i = 2; i < pts.length; i += 2)
      length += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
    if (length > bestLength) {
      bestLength = length;
      best = pts;
    }
  }
  if (!best || bestLength < textPx) return null;
  let walked = 0;
  for (let i = 2; i < best.length; i += 2) {
    const dx = best[i]! - best[i - 2]!;
    const dy = best[i + 1]! - best[i - 1]!;
    const step = Math.hypot(dx, dy);
    if (walked + step >= bestLength / 2) {
      const t = step > 0 ? (bestLength / 2 - walked) / step : 0;
      let angle = Math.atan2(dy, dx);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      return { x: best[i - 2]! + dx * t, y: best[i - 1]! + dy * t, angle };
    }
    walked += step;
  }
  return null;
}

/** Fill and stroke one band's layers, on rows `top` to `bottom` of the map image. */
export function drawBasemapBand(
  ctx: Ctx,
  drawing: BasemapDrawing,
  band: number,
  top: number,
  bottom: number,
) {
  if (band === 0) {
    ctx.fillStyle = drawing.background;
    ctx.fillRect(0, top, drawing.widthPx, bottom - top);
  }
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  for (const paint of drawing.paints) {
    if (paint.band !== band || !reachesRows(paint.rect, top, bottom)) continue;
    // A tile's geometry runs past its edge into a buffer its neighbour also
    // draws: without the clip, a translucent fill would darken every seam.
    ctx.save();
    ctx.beginPath();
    ctx.rect(paint.rect.x, paint.rect.y, paint.rect.w, paint.rect.h);
    ctx.clip();
    for (const ink of paint.inks) {
      ctx.globalAlpha = ink.opacity;
      ctx.beginPath();
      for (const pts of ink.rings) {
        ctx.moveTo(pts[0]!, pts[1]!);
        for (let i = 2; i < pts.length; i += 2)
          ctx.lineTo(pts[i]!, pts[i + 1]!);
      }
      if (ink.fill) {
        ctx.fillStyle = ink.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = ink.color;
        ctx.lineWidth = ink.width;
        ctx.setLineDash(ink.dash);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/** Draw the labels that reach rows `top` to `bottom`, over everything the base holds. */
export function drawBasemapLabels(
  ctx: Ctx,
  drawing: BasemapDrawing,
  top: number,
  bottom: number,
) {
  for (const label of drawing.labels) {
    if (label.y + label.reach < top || label.y - label.reach > bottom) continue;
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate(label.angle);
    ctx.font = label.font;
    // Browsers without it (Safari 17) keep the text's own spacing.
    ctx.letterSpacing = `${label.letterSpacing}px`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = label.halo;
    ctx.lineWidth = label.haloWidth * 2;
    ctx.fillStyle = label.color;
    const firstLine = (-(label.lines.length - 1) * label.lineHeight) / 2;
    label.lines.forEach((line, i) => {
      const y = firstLine + i * label.lineHeight;
      if (label.haloWidth > 0) ctx.strokeText(line, 0, y);
      ctx.fillText(line, 0, y);
    });
    ctx.restore();
  }
}
