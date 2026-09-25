// The direction arrowhead drawn along a route, and how a line is cut up so the
// arrows land where they should.
//
// Both clients draw this, so both read it from here. Logjam GPS worked it out
// first (2026-08-30) and Logjam Web was still drawing a `›` text glyph until
// 2026-09-17, with exactly the fault the glyph caused there: MapLibre centres a
// line-placed symbol on the box the font declares rather than on the ink, so a
// glyph drawn off-centre in its own advance box rides off-centre on the line —
// and with keep-upright off it rotates with the line, so the error swaps sides
// wherever a route doubles back. That reads as arrows wobbling rather than as a
// constant offset, which is what an operator reports as "not centred".
//
// THE ARROWHEAD IS AN IMAGE BECAUSE THE FONT HAS NO ARROWHEAD. The bundled Noto
// Sans pack ships no filled triangle: one glyph in the geometric block (U+25CC)
// and only U+2190-2199 in the arrows block, every one stemmed. A stem drawn
// along a line is a second line, so it reads as a bulge in the route rather
// than a mark on it, and sizing it up to be legible thickens the stem past the
// line itself. The image is an SDF (`routeArrowSdf.ts`, generated) so one image
// still takes each route's own colour — a plain bitmap ignores a tint, which
// would give every route on the map the same arrow colour.
//
// The style objects themselves stay with each client: MapLibre Native and
// MapLibre GL JS spell their layer properties differently, and neither spelling
// belongs in shared. What is here is what they must AGREE on.

// The image itself, re-exported so this module is the ONE import surface for
// drawing arrows — a client should never have to know the generated file's name
// to get the arrowhead that goes with these constants.
export { ROUTE_ARROW_SDF_URI } from "./routeArrowSdf.js";

/** Style-image name. Registered once per map, by whatever owns the style. */
export const ROUTE_ARROW_IMAGE = "route-arrow";

/** Below this a route is a few pixels of line and arrows on it are just noise. */
export const ROUTE_ARROW_MIN_ZOOM = 12;

/**
 * Scales the 64x48 source image, so the 26px arrowhead inside it draws about
 * 12px long on a 3px line. Tune here, not by regenerating the image: an SDF is
 * resolution-independent, which is half of why it is one.
 */
export const ROUTE_ARROW_ICON_SIZE = 0.45;

/**
 * Marks the per-segment features the arrow layer draws on, so the line layers
 * sharing the source can filter them back out.
 */
export const ARROW_FEATURE_KIND = "arrow";

/**
 * One arrow segment. Structurally a GeoJSON LineString feature — spelled out
 * here rather than imported, because `@types/geojson` is not a declared
 * dependency of this package and a global that arrives transitively can leave
 * the same way.
 */
export type ArrowSegmentFeature<P> = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] };
  properties: P & { kind: string };
};

/**
 * ONE FEATURE PER SEGMENT, drawn by the arrow layer only — the route itself
 * stays a single LineString for the line layers, because a line split into
 * segments joins them with two round caps instead of one line-join, and on a
 * tight corner that reads as a notch.
 *
 * This is what keeps arrows OFF the anchor handles. MapLibre places line
 * symbols starting half a spacing into each line and every spacing after that,
 * so a per-segment line puts the first arrow half a spacing past the anchor it
 * starts from, and a segment shorter than the spacing gets a single arrow at
 * its midpoint — the furthest point from both of its anchors. Doing it in
 * SCREEN space this way is why it holds at every zoom; trimming the geometry by
 * a ground distance instead would be a gap that grows as you zoom in and
 * vanishes as you zoom out, because the handle is a fixed size either way.
 *
 * It also stops an arrow straddling a corner, where its rotation would split
 * the difference between two segments and point at neither.
 *
 * The cost is roughly double the coordinates for a route (a shared pair per
 * segment rather than one run), which is why the segments carry only the
 * properties the arrow layer's own paint expressions read.
 */
export function arrowSegmentFeatures<P extends Record<string, unknown>>(
  points: readonly (readonly number[])[],
  properties: P,
): ArrowSegmentFeature<P>[] {
  const features: ArrowSegmentFeature<P>[] = [];
  for (let i = 1; i < points.length; i++) {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [[...points[i - 1]], [...points[i]]],
      },
      properties: { ...properties, kind: ARROW_FEATURE_KIND },
    });
  }
  return features;
}
