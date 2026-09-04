// Drag-a-box on the map, as the two pure pieces of it.
//
// Three surfaces draw the same rubber band — the topo job's bbox, the canyon
// multi-select, and the Canyons filter's area — and the first two shipped as
// two ~110-line copies of one another, differing only in what they did with the
// finished box. This is the arithmetic they share; `useBoxDraw` is the event
// wiring around it.
//
// PRIVACY: pure geometry over values the caller already holds. Nothing logs.
import type { RegionBbox } from "@logjam/shared";

/** A box the user drew, in map coordinates. */
export type BoxCorner = { lng: number; lat: number };

/** The overlay rectangle's CSS box, in coordinates relative to the container. */
export type OverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * The rectangle between the anchored corner and wherever the cursor is now.
 *
 * The anchor arrives already PROJECTED (container-relative pixels, re-derived
 * from its lng/lat on every frame), while the cursor arrives in client
 * coordinates straight off the mouse event — which is why one is offset by the
 * container's rect and the other is not. Keeping the anchor geographic is what
 * lets the box stay over the same ground while the map pans underneath it.
 */
export function boxOverlayRect(
  anchorInContainer: { x: number; y: number },
  cursorClient: { x: number; y: number },
  containerRect: { left: number; top: number },
): OverlayRect {
  const cursorX = cursorClient.x - containerRect.left;
  const cursorY = cursorClient.y - containerRect.top;
  const left = Math.min(anchorInContainer.x, cursorX);
  const top = Math.min(anchorInContainer.y, cursorY);
  return {
    left,
    top,
    width: Math.abs(anchorInContainer.x - cursorX),
    height: Math.abs(anchorInContainer.y - cursorY),
  };
}

/**
 * Two opposite corners in any order → a bbox.
 *
 * NSW-only product, so no antimeridian case: `west <= east` always holds, and a
 * box that wrapped 180° would need a different comparison than min/max.
 */
export function cornersToBbox(a: BoxCorner, b: BoxCorner): RegionBbox {
  return {
    west: Math.min(a.lng, b.lng),
    south: Math.min(a.lat, b.lat),
    east: Math.max(a.lng, b.lng),
    north: Math.max(a.lat, b.lat),
  };
}
