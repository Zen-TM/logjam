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
  return anchorIndexAtPress(anchors, press, degreesPerPixel) !== null;
}

/**
 * WHICH anchor a press landed on, or null for a press on open map.
 *
 * The same hit test, answering the question a TAP asks rather than the one a
 * long press asks. A tap inside an anchor's handle SELECTS that anchor — it
 * does not append a point, which is what it used to do, stacking a duplicate
 * vertex directly on top of the one the user was aiming at.
 *
 * NEAREST rather than first: two anchors a few pixels apart both satisfy the
 * tolerance, and picking the one further from the finger is a wrong answer the
 * user can see. Ties keep the earlier index, which is arbitrary but stable.
 */
export function anchorIndexAtPress(
  anchors: readonly RoutePoint[],
  press: RoutePoint,
  degreesPerPixel: number,
): number | null {
  const tolerance = degreesPerPixel * ANCHOR_GRAB_PIXELS;
  let bestIndex: number | null = null;
  let bestDistance = Infinity;
  for (let index = 0; index < anchors.length; index++) {
    const anchor = anchors[index]!;
    // Planar comparison in degrees, like `nearestSegment`'s: over a tolerance
    // of tens of pixels the longitude foreshortening at NSW latitudes is far
    // below the precision this decision needs.
    const distance = Math.hypot(anchor[0] - press[0], anchor[1] - press[1]);
    if (distance > tolerance || distance >= bestDistance) continue;
    bestIndex = index;
    bestDistance = distance;
  }
  return bestIndex;
}
