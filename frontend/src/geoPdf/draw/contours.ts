// Contour lines and their elevation labels. A port of the server's
// renderContourFeature, split so a render can place every label once, over the
// whole map, and draw the lines and labels strip by strip.
import {
  contourLabelHalo,
  contourWidthStops,
  lerpZoom,
  rgbaCssFromHex,
  TILE_SIZE,
  type TileToMapTransform,
  type VectorStyleSettings,
} from "@logjam/shared";
import { decodeVectorTileLayer } from "../vectorTile";
import { MAP_FONT, type Ctx } from "./common";

/** Min spacing between contour elevation labels, in map pixels. */
const CONTOUR_LABEL_MIN_DISTANCE = 450;

/** One contour line on the map image: x,y pairs, with its vertical extent. */
export type ContourLine = {
  pts: Float64Array;
  minY: number;
  maxY: number;
  major: boolean;
};

/** A label to draw: `radius` bounds it (and its halo) in any rotation. */
export type ContourLabel = {
  x: number;
  y: number;
  angle: number;
  text: string;
  fontPx: number;
  haloWidth: number;
  haloColor: string;
  color: string;
  radius: number;
};

export type ContourTileInput = {
  /** The archive it came from (`STATEWIDE` or an area's id). */
  source: string;
  /** Tile coordinates at the contour zoom. */
  x: number;
  y: number;
  data: Uint8Array | ArrayBuffer;
};

export type ContourDrawing = {
  lines: ContourLine[];
  labels: ContourLabel[];
  majorStyle: { color: string; width: number };
  minorStyle: { color: string; width: number };
  /** The sources with a tile that carried the `contours` layer (each is credited). */
  sources: Set<string>;
};

/** Label font size in map px: the 9px@z14 to 12px@z18 ramp times the scales. */
function labelFontSize(
  styleZoom: number,
  pxScale: number,
  labelScale: number,
): number {
  const t = Math.max(0, Math.min(1, (styleZoom - 14) / (18 - 14)));
  return (9 + t * (12 - 9)) * labelScale * pxScale;
}

/**
 * Decode every contour tile, lay out its lines on the map image, and place the
 * labels. Tiles are visited in (y, x) order, so the labels do not depend on
 * which tile arrived first. A tile that does not decode is skipped.
 */
export function buildContours(
  tiles: readonly ContourTileInput[],
  transform: TileToMapTransform,
  styleZoom: number,
  pxScale: number,
  style: VectorStyleSettings,
): ContourDrawing {
  const cs = style.contours;
  const widthOf = (widthM: number) => {
    const stops = contourWidthStops(widthM);
    return lerpZoom(styleZoom, stops.z12, stops.z18) * pxScale;
  };
  const majorStyle = {
    color: rgbaCssFromHex(cs.majorColour),
    width: widthOf(cs.majorWidthM),
  };
  const minorStyle = {
    color: rgbaCssFromHex(cs.minorColour),
    width: widthOf(cs.minorWidthM),
  };
  const fontPx = labelFontSize(styleZoom, pxScale, style.labelScale ?? 1);
  const haloWidth = 1.5 * pxScale;
  const haloColor = contourLabelHalo(cs.majorColour);
  const lines: ContourLine[] = [];
  const labels: ContourLabel[] = [];
  const sources = new Set<string>();

  const ordered = [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const tile of ordered) {
    let decoded;
    try {
      decoded = decodeVectorTileLayer(tile.data, "contours");
    } catch {
      continue;
    }
    if (!decoded.present) continue;
    sources.add(tile.source);
    const dx =
      ((tile.x - transform.minTileX) * TILE_SIZE - transform.offsetX) *
      transform.scaleX;
    const dy =
      ((tile.y - transform.minTileY) * TILE_SIZE - transform.offsetY) *
      transform.scaleY;
    for (const feature of decoded.features) {
      if (feature.type !== 2) continue; // contours are lines
      const elev = Number(feature.properties.elev ?? 0);
      const major = elev % 50 === 0;
      // Minor contours show from z14 (the live overlay's minzoom); major
      // contours have no minzoom.
      if (!major && styleZoom < 14) continue;
      const scaleX = (TILE_SIZE / feature.extent) * transform.scaleX;
      const scaleY = (TILE_SIZE / feature.extent) * transform.scaleY;
      for (const ring of feature.loadGeometry()) {
        const pts = new Float64Array(ring.length * 2);
        let minY = Infinity;
        let maxY = -Infinity;
        for (let j = 0; j < ring.length; j++) {
          const px = dx + ring[j]!.x * scaleX;
          const py = dy + ring[j]!.y * scaleY;
          pts[j * 2] = px;
          pts[j * 2 + 1] = py;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
        lines.push({ pts, minY, maxY, major });
        if (!major || styleZoom < 14 || ring.length < 2) continue;
        const mid = Math.floor(ring.length / 2);
        const mx = pts[mid * 2]!;
        const my = pts[mid * 2 + 1]!;
        if (
          labels.some(
            (p) => Math.hypot(p.x - mx, p.y - my) < CONTOUR_LABEL_MIN_DISTANCE,
          )
        )
          continue;
        const prev = mid > 0 ? mid - 1 : 0;
        const next = mid < ring.length - 1 ? mid + 1 : ring.length - 1;
        let angle = Math.atan2(
          (ring[next]!.y - ring[prev]!.y) * scaleY,
          (ring[next]!.x - ring[prev]!.x) * scaleX,
        );
        // Keep text upright
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        const text = `${elev}m`;
        labels.push({
          x: mx,
          y: my,
          angle,
          text,
          fontPx,
          haloWidth,
          haloColor,
          color: majorStyle.color,
          // Half the widest a bold glyph row of this length can be, half the
          // line height, and the halo: a circle holds it at any angle.
          radius:
            Math.hypot((text.length * fontPx * 0.7) / 2, fontPx * 0.7) +
            haloWidth +
            2,
        });
      }
    }
  }
  return { lines, labels, majorStyle, minorStyle, sources };
}

/** Stroke the lines that reach rows `top` to `bottom` of the map image. */
export function drawContourLines(
  ctx: Ctx,
  drawing: ContourDrawing,
  top: number,
  bottom: number,
) {
  ctx.setLineDash([]);
  for (const line of drawing.lines) {
    const style = line.major ? drawing.majorStyle : drawing.minorStyle;
    const reach = style.width / 2 + 1;
    if (line.maxY + reach < top || line.minY - reach > bottom) continue;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.beginPath();
    const { pts } = line;
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j]!, pts[j + 1]!);
    ctx.stroke();
  }
}

/** Draw the labels that reach rows `top` to `bottom`, on top of every line. */
export function drawContourLabels(
  ctx: Ctx,
  drawing: ContourDrawing,
  top: number,
  bottom: number,
) {
  for (const lbl of drawing.labels) {
    if (lbl.y + lbl.radius < top || lbl.y - lbl.radius > bottom) continue;
    ctx.save();
    ctx.translate(lbl.x, lbl.y);
    ctx.rotate(lbl.angle);
    ctx.font = `bold ${lbl.fontPx}px ${MAP_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = lbl.haloColor;
    ctx.lineWidth = lbl.haloWidth;
    ctx.strokeText(lbl.text, 0, 0);
    ctx.fillStyle = lbl.color;
    ctx.fillText(lbl.text, 0, 0);
    ctx.restore();
  }
}
