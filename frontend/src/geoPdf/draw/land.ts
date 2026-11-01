// Land tenure on a print: the same classes and borders as a map.
import {
  LAND_CLASSES,
  LAND_EDGE_LINES,
  landClass,
  MAP_TERRAIN,
  NSW_LAND,
  TILE_SIZE,
  type TileToMapTransform,
} from "@logjam/shared";
import { decodeVectorTileLayer } from "../vectorTile";
import { INK, MAP_FONT, mmToPx, type Ctx } from "./common";
import { drawElementBackground } from "./elements";

export type LandTileInput = {
  /** Tile coordinates at the land zoom. */
  x: number;
  y: number;
  data: Uint8Array | ArrayBuffer;
};

/** One feature of one tile on the map image: its rings as x,y pairs. */
export type LandShape = {
  /** The class's colour. */
  color: string;
  /** Map-image pixels to one pixel of a map tile drawn at its own zoom. */
  pixel: number;
  rings: Float64Array[];
  /** The tile's square on the map image, in whole pixels. */
  clip: { left: number; top: number; right: number; bottom: number };
};

/**
 * Decode every land tile and lay its polygons out on the map image. A tile that
 * does not decode is skipped. A tile's polygons run past its edge into its
 * neighbour's, so each is clipped to a whole-pixel square: two neighbours then
 * share an edge exactly, with no doubled line and no seam.
 */
export function buildLand(
  tiles: readonly LandTileInput[],
  transform: TileToMapTransform,
): LandShape[] {
  const shapes: LandShape[] = [];
  const size = TILE_SIZE;
  for (const tile of tiles) {
    let decoded;
    try {
      decoded = decodeVectorTileLayer(tile.data, NSW_LAND.sourceLayer);
    } catch {
      continue;
    }
    const dx =
      ((tile.x - transform.minTileX) * size - transform.offsetX) *
      transform.scaleX;
    const dy =
      ((tile.y - transform.minTileY) * size - transform.offsetY) *
      transform.scaleY;
    const clip = {
      left: Math.round(dx),
      top: Math.round(dy),
      right: Math.round(dx + size * transform.scaleX),
      bottom: Math.round(dy + size * transform.scaleY),
    };
    for (const feature of decoded.features) {
      const kind = landClass(feature.properties[NSW_LAND.classProperty]);
      if (feature.type !== 3 || !kind) continue;
      const scaleX = (size / feature.extent) * transform.scaleX;
      const scaleY = (size / feature.extent) * transform.scaleY;
      shapes.push({
        color: kind.colour,
        // A map draws a 256-unit tile 512 pixels across.
        pixel: transform.scaleX / 2,
        clip,
        rings: feature.loadGeometry().map((ring) => {
          const pts = new Float64Array(ring.length * 2);
          ring.forEach(({ x, y }, j) => {
            pts[j * 2] = dx + x * scaleX;
            pts[j * 2 + 1] = dy + y * scaleY;
          });
          return pts;
        }),
      });
    }
  }
  return shapes;
}

/**
 * A soft line's strength on paper against a map's: a canvas line has no blur a
 * print can trust in every browser, so it stops at a hard edge at full strength,
 * and reads far stronger than the same line feathered away on a screen.
 */
const SOFT_LINE_ON_PAPER = 0.35;

/**
 * Draw the borders of the shapes whose tile reaches rows `top` to `bottom` of
 * the map image. A canvas can't push a line inwards, so each is stroked twice
 * as wide with its holding as the clip.
 */
export function drawLand(
  ctx: Ctx,
  shapes: readonly LandShape[],
  top: number,
  bottom: number,
) {
  for (const { color, pixel, rings, clip } of shapes) {
    if (clip.bottom < top || clip.top > bottom) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      clip.left,
      clip.top,
      clip.right - clip.left,
      clip.bottom - clip.top,
    );
    ctx.clip();
    ctx.beginPath();
    for (const pts of rings) {
      ctx.moveTo(pts[0]!, pts[1]!);
      for (let j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j]!, pts[j + 1]!);
      ctx.closePath();
    }
    ctx.clip("evenodd");
    ctx.strokeStyle = color;
    for (const { width, offset, blur, opacity } of LAND_EDGE_LINES) {
      ctx.globalAlpha = blur ? opacity * SOFT_LINE_ON_PAPER : opacity;
      ctx.lineWidth = (offset * 2 + width) * pixel;
      ctx.stroke();
    }
    ctx.restore();
  }
}

type Box = { left: number; top: number; right: number; bottom: number };

/** Whether the line from x1,y1 to x2,y2 touches `box` (Liang-Barsky). */
function touches(x1: number, y1: number, x2: number, y2: number, box: Box) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let from = 0;
  let to = 1;
  for (const [p, q] of [
    [-dx, x1 - box.left],
    [dx, box.right - x1],
    [-dy, y1 - box.top],
    [dy, box.bottom - y1],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
    } else if (p < 0) from = Math.max(from, q / p);
    else to = Math.min(to, q / p);
    if (from > to) return false;
  }
  return true;
}

/**
 * The classes with a border on a map image `width` by `height`, in the legend's
 * order. Each tile counts only inside its own square: a ring is cut where the
 * tile's margin ends, and that edge, out in the neighbour's square, is no
 * border. A class that fills the whole sheet draws nothing to explain.
 */
export function landClassesDrawn(
  shapes: readonly LandShape[],
  width: number,
  height: number,
) {
  const found = new Set<string>();
  for (const { color, rings, clip } of shapes) {
    if (found.has(color)) continue;
    const box = {
      left: Math.max(clip.left, 0),
      top: Math.max(clip.top, 0),
      right: Math.min(clip.right, width),
      bottom: Math.min(clip.bottom, height),
    };
    const crosses = rings.some((pts) => {
      for (let j = 0; j < pts.length; j += 2) {
        const next = (j + 2) % pts.length;
        const [x1, y1] = [pts[j]!, pts[j + 1]!];
        if (touches(x1, y1, pts[next]!, pts[next + 1]!, box)) return true;
      }
      return false;
    });
    if (crosses) found.add(color);
  }
  return LAND_CLASSES.filter(({ colour }) => found.has(colour));
}

/**
 * The panel saying which colour is who, above `stackY` at the left of the map
 * like the elements under it. Returns the next `stackY`, which is `stackY` when
 * there is nothing to explain.
 */
export function drawLandLegend(
  ctx: Ctx,
  classes: readonly { name: string; colour: string }[],
  stackY: number,
  margin: number,
  padH: number,
  padV: number,
  dpi: number,
): number {
  if (classes.length === 0) return stackY;
  const title = MAP_TERRAIN.copy.land;
  const fontPx = mmToPx(2.6, dpi);
  const rowH = mmToPx(4, dpi);
  const swatchW = mmToPx(6, dpi);
  const swatchH = mmToPx(1.4, dpi);
  const gap = mmToPx(1.5, dpi);

  ctx.font = `bold ${fontPx}px ${MAP_FONT}`;
  const titleW = ctx.measureText(title).width;
  ctx.font = `${fontPx}px ${MAP_FONT}`;
  const nameW = Math.max(
    ...classes.map(({ name }) => ctx.measureText(name).width),
  );
  const boxW = Math.max(titleW, swatchW + gap + nameW) + padH * 2;
  const boxH = rowH * (classes.length + 1) + padV * 2;
  const y = stackY - boxH;

  drawElementBackground(ctx, margin, y, boxW, boxH, dpi);
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  ctx.font = `bold ${fontPx}px ${MAP_FONT}`;
  ctx.fillText(title, margin + padH, y + padV + rowH / 2);
  ctx.font = `${fontPx}px ${MAP_FONT}`;
  classes.forEach(({ name, colour }, i) => {
    const mid = y + padV + rowH * (i + 1.5);
    ctx.fillStyle = colour;
    ctx.fillRect(margin + padH, mid - swatchH / 2, swatchW, swatchH);
    ctx.fillStyle = INK;
    ctx.fillText(name, margin + padH + swatchW + gap, mid);
  });
  ctx.textBaseline = "alphabetic";

  return y - mmToPx(1, dpi);
}
