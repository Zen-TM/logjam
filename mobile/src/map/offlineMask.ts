// "Offline maps only" used to leave a blurry smear around every downloaded
// area. Nothing was wrong: a region pyramid starts at z8, and one z8 tile
// covers hundreds of kilometres, so MapLibre draws that whole tile wherever it
// overlaps the source's bounds — upscaled 256× at walking zoom. The result
// reads as a map, a soft and wrong one, over ground the phone has no real data
// for.
//
// So the map draws its own edge: a fill over everywhere EXCEPT the downloaded
// regions, mounted directly above the basemap band. Inside a region you see
// the tiles you saved; outside it you see that there is nothing there, which is
// the true answer.
//
// The complement is built as DISJOINT RECTANGLES, not as a world polygon with
// a hole per region. Holes are the obvious encoding and they do not survive
// contact with reality: two saved areas that overlap (the same ground saved at
// two depths, which is a normal thing to do) give earcut two overlapping holes,
// and it triangulates them into a wedge of map that stays visible. Rectangles
// of the complement can't overlap by construction.

/** [west, south, east, north] */
export type MaskBbox = [number, number, number, number];

// Web Mercator's own latitude limit.
const MERCATOR_LIMIT = 85.06;

/**
 * How far past the saved regions the mask extends, in degrees (~220 km).
 *
 * NOT the whole world: a single fill polygon spanning 360° of longitude is
 * carried into every tile MapLibre builds and did not render at all on device.
 * The pad only has to cover the ground a z8 tile can smear into view, and by
 * the time the user is 220 km outside their saved area the map is zoomed far
 * enough out that a low-detail tile is honest rather than misleading.
 */
const MASK_PAD_DEGREES = 2;

function rectangle(
  west: number,
  south: number,
  east: number,
  north: number,
): GeoJSON.Position[][] {
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ];
}

/**
 * Everywhere the given boxes do NOT cover, as a MultiPolygon — or null when
 * there is nothing to punch out (no regions ⇒ nothing to reveal ⇒ the basemap
 * is already reporting itself unavailable, and a full-screen blackout on top of
 * that notice helps no one).
 *
 * Method: cut the world into vertical bands at every box edge. Inside one band
 * each box either spans it fully or not at all, so the covered latitudes are
 * just a set of intervals — merge them, and the gaps are the band's share of
 * the complement.
 */
export function offlineCoverageMask(boxes: MaskBbox[]): GeoJSON.Feature | null {
  if (boxes.length === 0) return null;

  const outerWest = Math.max(-180, Math.min(...boxes.map(([w]) => w)) - MASK_PAD_DEGREES);
  const outerEast = Math.min(180, Math.max(...boxes.map(([, , e]) => e)) + MASK_PAD_DEGREES);
  const outerSouth = Math.max(
    -MERCATOR_LIMIT,
    Math.min(...boxes.map(([, s]) => s)) - MASK_PAD_DEGREES,
  );
  const outerNorth = Math.min(
    MERCATOR_LIMIT,
    Math.max(...boxes.map(([, , , n]) => n)) + MASK_PAD_DEGREES,
  );

  const cuts = [outerWest, outerEast];
  for (const [west, , east] of boxes) {
    if (west > outerWest && west < outerEast) cuts.push(west);
    if (east > outerWest && east < outerEast) cuts.push(east);
  }
  const edges = [...new Set(cuts)].sort((a, b) => a - b);

  const polygons: GeoJSON.Position[][][] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const bandWest = edges[i];
    const bandEast = edges[i + 1];
    if (bandEast <= bandWest) continue;

    // Boxes spanning this whole band, as latitude intervals, merged.
    const spans = boxes
      .filter(([west, , east]) => west <= bandWest && east >= bandEast)
      .map(([, south, , north]): [number, number] => [south, north])
      .sort((a, b) => a[0] - b[0]);
    const covered: [number, number][] = [];
    for (const [south, north] of spans) {
      const last = covered[covered.length - 1];
      if (last && south <= last[1]) last[1] = Math.max(last[1], north);
      else covered.push([south, north]);
    }

    // The gaps between (and around) those intervals are uncovered ground.
    let cursor = outerSouth;
    for (const [south, north] of covered) {
      if (south > cursor) {
        polygons.push(rectangle(bandWest, cursor, bandEast, Math.min(south, outerNorth)));
      }
      cursor = Math.max(cursor, north);
    }
    if (cursor < outerNorth) {
      polygons.push(rectangle(bandWest, cursor, bandEast, outerNorth));
    }
  }

  if (polygons.length === 0) return null;
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "MultiPolygon", coordinates: polygons },
  };
}
