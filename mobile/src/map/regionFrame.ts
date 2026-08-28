// The download screen's selection frame, as pure geometry.
//
// The frame is stored as insets in SCREEN pixels from the map view's edges, and
// converted to a geographic bbox with the map's own visible bounds as the
// reference rectangle. That conversion is synchronous — which is the whole
// point: dragging an edge updates the tile count and the size estimate in the
// same frame as the finger moves, where round-tripping through the native
// `getCoordinateFromView` per drag event would lag behind it.
//
// It assumes a NORTH-UP, unpitched map, because `getVisibleBounds` returns the
// axis-aligned box around a rotated view, which no linear mapping can undo. The
// download screen disables rotation and pitch for exactly this reason.
import type { RegionBbox } from "@logjam/shared";

export type FrameInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type FrameViewport = {
  north: number;
  south: number;
  east: number;
  west: number;
  /** Map view size in the same pixel units as the insets. */
  width: number;
  height: number;
};

export type FrameEdge = "top" | "right" | "bottom" | "left";

/** Nothing smaller than a comfortable thumb-width of map. */
export const MIN_FRAME_PX = 72;

/** Web Mercator y for a latitude (unscaled) — linear in screen space. */
function mercatorY(latitude: number): number {
  return Math.asinh(Math.tan((latitude * Math.PI) / 180));
}

function inverseMercatorY(y: number): number {
  return (Math.atan(Math.sinh(y)) * 180) / Math.PI;
}

/**
 * Frame insets → the area the user has framed. Longitude is linear in x;
 * latitude is linear in *Mercator* y, not in degrees (a 1:1 degree mapping
 * skews the box, and the skew grows with how much of the world is on screen).
 */
export function frameToBbox(view: FrameViewport, frame: FrameInsets): RegionBbox {
  const lonSpan = view.east - view.west;
  const west = view.west + (frame.left / view.width) * lonSpan;
  const east = view.west + ((view.width - frame.right) / view.width) * lonSpan;

  const yNorth = mercatorY(view.north);
  const ySouth = mercatorY(view.south);
  const ySpan = ySouth - yNorth;
  const north = inverseMercatorY(yNorth + (frame.top / view.height) * ySpan);
  const south = inverseMercatorY(
    yNorth + ((view.height - frame.bottom) / view.height) * ySpan,
  );
  return { west, south, east, north };
}

/**
 * Move one edge by a drag delta, keeping the frame inside the view and no
 * smaller than MIN_FRAME_PX. Each handle is a one-dimensional constraint, which
 * is why edges are the handles rather than corners: there is no anchor to track
 * and no aspect ratio to couple, so any shape is reachable — a tall narrow strip
 * for a creek line, a wide short one for a plateau.
 */
export function moveFrameEdge(
  frame: FrameInsets,
  edge: FrameEdge,
  deltaPx: number,
  size: { width: number; height: number },
): FrameInsets {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  switch (edge) {
    case "top":
      return {
        ...frame,
        top: clamp(frame.top + deltaPx, size.height - frame.bottom - MIN_FRAME_PX),
      };
    case "bottom":
      return {
        ...frame,
        bottom: clamp(frame.bottom - deltaPx, size.height - frame.top - MIN_FRAME_PX),
      };
    case "left":
      return {
        ...frame,
        left: clamp(frame.left + deltaPx, size.width - frame.right - MIN_FRAME_PX),
      };
    case "right":
      return {
        ...frame,
        right: clamp(frame.right - deltaPx, size.width - frame.left - MIN_FRAME_PX),
      };
  }
}

/** Opening frame: a generous inset, so all four handles are visible at once. */
export function defaultFrameInsets(size: {
  width: number;
  height: number;
}): FrameInsets {
  const horizontal = Math.round(size.width * 0.12);
  const vertical = Math.round(size.height * 0.16);
  return {
    top: vertical,
    bottom: vertical,
    left: horizontal,
    right: horizontal,
  };
}

/**
 * Ground resolution at the centre of a bbox, for the detail picker's caption.
 * "z16" means nothing on its own; "≈ 2 m per pixel" is the thing a user can
 * actually judge a map against.
 *
 * Re-exported (not reimplemented) from scaleBar.ts's `tileMetersPerPixel`:
 * this screen plans against slippy-tile zooms (256-based), the opposite
 * convention from a MapLibre `camera.zoom` — see that file's header for why
 * a second copy of this formula is how the convention split stops being
 * discoverable (MMO-001/MMO-003).
 */
export { tileMetersPerPixel as metresPerPixel } from "./scaleBar";
