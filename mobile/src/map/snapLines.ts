// Candidate ways for snapping, read off the rendered vector basemap.
//
// Mobile has no querySourceFeatures — the wrapper exposes only
// queryRenderedFeaturesInRect — so this asks for what is DRAWN. Two
// consequences, both deliberate rather than worked around:
//
//  - Snapping needs the Protomaps vector basemap to be the active one. On a
//    SIX or OSM raster basemap there is no geometry on the map to query, and
//    this returns nothing, which the tools render as the straight line they
//    would have drawn anyway.
//  - Only what is on screen is available. That is exactly the segment being
//    drawn, since both ends of it were just tapped.
//
// PRIVACY: the returned geometry is map data, not user data, but the query
// rect describes where the user is looking. Nothing here logs.
import type { SnapLine, SnapMode } from "@logjam/shared";

/** Protomaps schema: OSM paths/tracks, and flowing water. */
const TRAIL_KINDS = ["path"];
const WATERWAY_KINDS = ["stream", "river", "canal"];

/**
 * Below this zoom the extract serves simplified tiles with creeks and paths
 * dropped, so snapping would silently do nothing. Matches the web constant.
 */
export const SNAP_MIN_ZOOM = 14;

// The wrapper types `filter` as its own FilterExpression tuple, which is
// stricter than the expression below can be expressed as; `never` lets the
// call site pass a plain expression without widening the wrapper's type.
type QueryRect = (
  bbox: GeoJSON.BBox,
  filter: never,
  layerIDs: string[],
) => Promise<GeoJSON.FeatureCollection>;

export function snapKindsFor(mode: SnapMode): string[] {
  switch (mode) {
    case "trails":
      return TRAIL_KINDS;
    case "waterways":
      return WATERWAY_KINDS;
    case "both":
      return [...TRAIL_KINDS, ...WATERWAY_KINDS];
    case "off":
      return [];
  }
}

/**
 * Pull snappable ways out of the rendered map.
 *
 * `bbox` is in SCREEN coordinates, which is what queryRenderedFeaturesInRect
 * takes despite the GeoJSON.BBox type — [top, right, bottom, left].
 *
 * Layer ids are deliberately not narrowed: the generated Protomaps style
 * splits paths and water across several layers whose ids would have to be kept
 * in lockstep with a regenerated style file. Filtering on `kind` and keeping
 * only line geometry is stabler, and drops water POLYGONS (lakes) for free —
 * a lake is not something to route along.
 */
export async function collectSnapLines(
  queryRect: QueryRect,
  mode: SnapMode,
  screenBbox: GeoJSON.BBox,
): Promise<SnapLine[]> {
  const kinds = snapKindsFor(mode);
  if (kinds.length === 0) return [];

  let collection: GeoJSON.FeatureCollection;
  try {
    collection = await queryRect(
      screenBbox,
      ["in", ["get", "kind"], ["literal", kinds]] as never,
      [],
    );
  } catch {
    // A query against a basemap with nothing to match is not an error worth
    // surfacing — the tool falls back to a straight line either way.
    return [];
  }

  const lines: SnapLine[] = [];
  for (const feature of collection.features ?? []) {
    const geometry = feature.geometry;
    if (geometry.type === "LineString") {
      lines.push({ coords: geometry.coordinates as [number, number][] });
    } else if (geometry.type === "MultiLineString") {
      for (const part of geometry.coordinates) {
        lines.push({ coords: part as [number, number][] });
      }
    }
  }
  return lines;
}
