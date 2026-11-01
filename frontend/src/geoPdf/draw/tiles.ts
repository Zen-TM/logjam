// Base-layer and raster tiles onto the map image.
import {
  TILE_SIZE,
  type TileCoord,
  type TileToMapTransform,
} from "@logjam/shared";
import type { Ctx } from "./common";

/** Where a tile lands on the map image, snapped out to whole pixels so
 *  neighbours share an edge and no seam shows. */
export type TileRect = { x: number; y: number; w: number; h: number };

export function tileRect(tile: TileCoord, t: TileToMapTransform): TileRect {
  const rawX = ((tile.x - t.minTileX) * TILE_SIZE - t.offsetX) * t.scaleX;
  const rawY = ((tile.y - t.minTileY) * TILE_SIZE - t.offsetY) * t.scaleY;
  const x0 = Math.floor(rawX);
  const y0 = Math.floor(rawY);
  const x1 = Math.ceil(rawX + TILE_SIZE * t.scaleX);
  const y1 = Math.ceil(rawY + TILE_SIZE * t.scaleY);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function drawTile(ctx: Ctx, image: ImageBitmap, r: TileRect) {
  ctx.drawImage(image, 0, 0, TILE_SIZE, TILE_SIZE, r.x, r.y, r.w, r.h);
}

/** A base tile that did not load. */
export function drawMissingTile(ctx: Ctx, r: TileRect) {
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

/** Whether the rect reaches rows `top` to `bottom` of the map image. */
export const reachesRows = (r: TileRect, top: number, bottom: number) =>
  r.y < bottom && r.y + r.h > top;
