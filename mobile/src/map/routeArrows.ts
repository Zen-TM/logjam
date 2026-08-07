// Where to put the little direction arrows along a route, and which way each
// one points.
//
// Pure maths, in JS, because the declarative way does not work here: a
// SymbolLayer with `symbol-placement: "line"` is how the web does it and how
// this SHOULD be done — MapLibre then spaces and rotates the glyphs itself as
// the camera moves. On this MapLibre React Native setup a SymbolLayer inside a
// ShapeSource renders nothing at all (verified on device: line placement,
// point placement, an ASCII glyph, allow-overlap, no filter, 30px red text —
// nothing draws, while the basemap's own vector-tile symbol layers render
// fine). So the arrows are placed here and drawn as markers instead.
//
// ponytail: fixed COUNT, not fixed spacing — the arrows do not re-space as you
// zoom, where the web's do. Upgrade path is deleting this file and going back
// to a SymbolLayer once MLRN renders one over a ShapeSource.
import { haversineMeters, initialBearingDegrees, type RoutePoint } from "@logjam/shared";

/** Enough to read direction at a glance; few enough to stay markers. */
export const ROUTE_ARROW_COUNT = 5;

export type RouteArrow = {
  coordinate: RoutePoint;
  /** Degrees clockwise from north, for a CSS-style rotation. */
  bearing: number;
};

/**
 * `count` arrows spaced evenly along the line by DISTANCE, not by vertex.
 *
 * Vertex spacing would bunch every arrow into the snapped section, where the
 * vertices are: a 500 m route that follows a creek carries twenty points in
 * one bend and two across the next kilometre.
 *
 * Placed at fractions 1/(n+1) … n/(n+1) so none lands on an endpoint, where it
 * would sit under the start/end anchor handles.
 */
export function routeArrows(
  points: readonly RoutePoint[],
  count: number = ROUTE_ARROW_COUNT,
): RouteArrow[] {
  if (points.length < 2 || count < 1) return [];

  const spans: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const span = haversineMeters(
      points[i - 1]![1],
      points[i - 1]![0],
      points[i]![1],
      points[i]![0],
    );
    spans.push(span);
    total += span;
  }
  // A zero-length line (every vertex identical) has no direction to show.
  if (total === 0) return [];

  const arrows: RouteArrow[] = [];
  for (let n = 1; n <= count; n++) {
    const target = (total * n) / (count + 1);
    let travelled = 0;
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!;
      if (travelled + span < target || span === 0) {
        travelled += span;
        continue;
      }
      const from = points[i]!;
      const to = points[i + 1]!;
      const fraction = (target - travelled) / span;
      arrows.push({
        coordinate: [
          from[0] + (to[0] - from[0]) * fraction,
          from[1] + (to[1] - from[1]) * fraction,
        ],
        bearing: initialBearingDegrees(from[1], from[0], to[1], to[0]),
      });
      break;
    }
  }
  return arrows;
}
