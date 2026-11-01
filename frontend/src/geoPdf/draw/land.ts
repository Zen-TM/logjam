// Land tenure on a print: the same classes and borders as a map.
import {
  LAND_EDGE_LINES,
  landClass,
  NSW_LAND,
  TILE_SIZE,
  type TileToMapTransform,
} from "@logjam/shared";
import { decodeVectorTileLayer } from "../vectorTile";
import type { Ctx } from "./common";

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
