// The Land overlay on a print: the same classes, tint and borders as a map
// close in.
import {
  LAND_EDGE_LINES,
  landClass,
  landTint,
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
  color: string;
  /** The class's solid colour, for its border. */
  edge: string;
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
 * share an edge exactly, with no doubled tint and no seam.
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
        color: landTint(kind),
        edge: kind.colour,
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
 * Tint the shapes whose tile reaches rows `top` to `bottom` of the map image,
 * and draw their borders. A canvas can't push a line inwards, so each is
 * stroked twice as wide with the polygon as its clip, and it has no blur a
 * print can trust in every browser, so the soft lines end in a hard edge.
 */
export function drawLand(
  ctx: Ctx,
  shapes: readonly LandShape[],
  top: number,
  bottom: number,
) {
  for (const { color, edge, pixel, rings, clip } of shapes) {
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
    const outline = () => {
      ctx.beginPath();
      for (const pts of rings) {
        ctx.moveTo(pts[0]!, pts[1]!);
        for (let j = 2; j < pts.length; j += 2)
          ctx.lineTo(pts[j]!, pts[j + 1]!);
        ctx.closePath();
      }
    };
    ctx.fillStyle = color;
    outline();
    ctx.fill("evenodd");
    ctx.clip("evenodd");
    ctx.strokeStyle = edge;
    for (const { width, offset, opacity } of LAND_EDGE_LINES) {
      ctx.globalAlpha = opacity;
      ctx.lineWidth = (offset * 2 + width) * pixel;
      ctx.stroke();
    }
    ctx.restore();
  }
}
