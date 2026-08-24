import type { RoutePoint } from "@logjam/shared";

/**
 * How near an existing anchor a press must land to count as landing ON it,
 * in DP.
 *
 * 22 dp of reach around a point is a 44 dp target — the standard one, and the
 * point of the number. The invisible handle `RouteDraftLayer` draws is 34 dp
 * wide (17 dp of reach) and the annotation CONSUMES every tap inside it (the
 * symbol manager's click listener returns true, so `MLRNMapView.onMapClick`
 * never runs), so this test only ever decides the 17–22 dp ring around it. It
 * was 20 dp against a tolerance that divided by `PixelRatio.get()` — under
 * 15 dp of real reach, i.e. INSIDE the handle, i.e. dead code that could not
 * fire. See `degreesPerDp` in scaleBar.ts.
 */
export const ANCHOR_GRAB_DP = 22;

/**
 * How far an anchor may travel and still be a TAP rather than a drag, in DP.
 *
 * A finger that moves a couple of pixels while tapping used to "drag" the
 * anchor a metre or two and select nothing at all — the drop committed a move
 * and armed the guard that suppresses the select. Android's own touch slop is
 * 8 dp, which is the figure every other view on the phone uses to answer this
 * same question, so it is the one used here.
 */
export const ANCHOR_TAP_SLOP_DP = 8;

/**
 * How long after a real drop a select is still that drop's own, in ms.
 *
 * The drop fires a select too, and picking up the handle you just put down
 * fights the gesture. This was a sticky boolean, which is worse than it looks:
 * nothing cleared it except the next select, so when a drop did NOT produce
 * one the flag stayed armed and ate the user's NEXT genuine tap — one of the
 * reasons picking a point to delete felt impossible.
 */
export const ANCHOR_DROP_SELECT_MS = 300;

/**
 * Whether a drag that ended at `to` having started at `from` was really a tap.
 *
 * Pure, so the threshold has a test rather than living inside a gesture
 * callback no renderer in this repo can reach.
 */
export function dragIsTap(
  from: RoutePoint,
  to: RoutePoint,
  degreesPerDp: number,
): boolean {
  return (
    Math.hypot(to[0] - from[0], to[1] - from[1]) <=
    degreesPerDp * ANCHOR_TAP_SLOP_DP
  );
}

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
  degreesPerDp: number,
): boolean {
  return anchorIndexAtPress(anchors, press, degreesPerDp) !== null;
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
  degreesPerDp: number,
): number | null {
  const tolerance = degreesPerDp * ANCHOR_GRAB_DP;
  let bestIndex: number | null = null;
  let bestDistance = Infinity;
  for (let index = 0; index < anchors.length; index++) {
    const anchor = anchors[index]!;
    // Planar comparison in degrees, like `nearestSegment`'s: over a tolerance
    // of tens of DP the longitude foreshortening at NSW latitudes is far
    // below the precision this decision needs.
    const distance = Math.hypot(anchor[0] - press[0], anchor[1] - press[1]);
    if (distance > tolerance || distance >= bestDistance) continue;
    bestIndex = index;
    bestDistance = distance;
  }
  return bestIndex;
}
