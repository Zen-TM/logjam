import type { RoutePoint } from "@logjam/shared";

/**
 * How near an existing anchor a press must land to count as landing ON it.
 *
 * Matched to the invisible touch target RouteDraftLayer draws around each
 * anchor (34 px wide, so 17 px of reach) with a little margin, because the
 * question here is "did the user mean to grab this handle", and the handle is
 * what they were aiming at.
 */
export const ANCHOR_GRAB_PIXELS = 20;

/**
 * A PRESS-AND-HOLD ON AN ANCHOR IS A DRAG, NOT AN INSERT.
 *
 * MLRN 10's PointAnnotation consumed the touch that started an anchor drag, so
 * the map never saw it. MLRN 11's ViewAnnotation does not: the same long press
 * that begins the drag ALSO arrives at the map's `onLongPress`, which is wired
 * to "insert a point near the line". Dragging an anchor therefore moved it and
 * left a new anchor behind at the spot the finger went down — observed on
 * device as a two-point route becoming a three-point one.
 *
 * Ordering is why this is a hit test rather than an "am I dragging" flag: the
 * native long-press and the drag-start callback race, so a flag set in
 * `onAnchorDragStart` may well be set too late. Position cannot be too late.
 *
 * It is also the right rule independent of MLRN: an insert one finger-width
 * from an existing anchor was never a useful thing to produce.
 */
export function pressIsOnAnchor(
  anchors: readonly RoutePoint[],
  press: RoutePoint,
  degreesPerPixel: number,
): boolean {
  const tolerance = degreesPerPixel * ANCHOR_GRAB_PIXELS;
  return anchors.some((anchor) => {
    // Planar comparison in degrees, like `nearestSegment`'s: over a tolerance
    // of tens of pixels the longitude foreshortening at NSW latitudes is far
    // below the precision this decision needs.
    const deltaLon = anchor[0] - press[0];
    const deltaLat = anchor[1] - press[1];
    return Math.hypot(deltaLon, deltaLat) <= tolerance;
  });
}
