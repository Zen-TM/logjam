// The Terrain group's archives once the user can see a sharpened area, cut
// into rectangles that MapLibre Native can draw one each: every tile from
// exactly one archive, the statewide one or one area's, as
// `terrainTileArchive` decides (shared/src/sharpen.ts, ADR 0040).
//
// Logjam Web routes each tile in a protocol handler (terrainRouter.ts).
// MapLibre Native has no such hook, and drawing an area over the statewide
// archive leaks: the slope bands paint flat ground clear, so the statewide 5 m
// band shows through around every sharp 1 m one, and two hillshades shade the
// same ground. So the statewide layer stops where routing starts, and from
// there each rectangle is a source of its own whose TileJSON `bounds` keep
// it to its tiles (terrainRoutes.test.ts).
//
// PRIVACY: an area's tile range says where its owner surveyed. Nothing here
// logs.
import {
  TERRAIN_ROUTED_FROM,
  lonLatToTile,
  terrainTileArchive,
  type SharpenedArea,
  type TerrainArchiveLayer,
} from "@logjam/shared";

/**
 * The fixed address a source reads one of an area's archives at: a request
 * transform turns it into the area's presigned URL (sharpenedArchives.ts).
 */
export function sharpenedArchiveAddress(
  areaId: string,
  layer: TerrainArchiveLayer,
): string {
  return `https://sharpened-area.invalid/${areaId}/${layer}.pmtiles`;
}

/** One rectangle of tiles, inclusive, at its layer's `TERRAIN_ROUTED_FROM` zoom. */
export type TileRect = readonly [
  x0: number,
  y0: number,
  x1: number,
  y1: number,
];

export type TerrainRoute<A extends SharpenedArea> = {
  archive: "statewide" | A;
  tiles: TileRect;
};

/**
 * The world at `TERRAIN_ROUTED_FROM[layer]`, cut along every area's range into
 * rectangles each read from one archive. Every tile is in exactly one, and
 * its archive is the one `terrainTileArchive` picks for the tile and for
 * every descendant it has.
 */
export function terrainRoutes<A extends SharpenedArea>(
  areas: readonly A[],
  layer: TerrainArchiveLayer,
): TerrainRoute<A>[] {
  const z = TERRAIN_ROUTED_FROM[layer];
  const shift = 15 - z;
  const ranges = areas
    .filter((a) => layer !== "contours" || a.contours)
    .map((a) => a.tiles15.map((v) => v >> shift));
  // Within a cell between two cuts each way, every tile has the same archive.
  const cuts = (lo: 0 | 1, hi: 2 | 3) =>
    [
      ...new Set([0, 2 ** z, ...ranges.flatMap((r) => [r[lo], r[hi] + 1])]),
    ].sort((a, b) => a - b);
  const xs = cuts(0, 2);
  const ys = cuts(1, 3);
  const routes: { archive: "statewide" | A; tiles: number[] }[] = [];
  // The previous column's routes by archive and rows, to widen instead of
  // starting a new one: fewer sources on the map.
  let previous = new Map<string, (typeof routes)[number]>();
  for (let i = 0; i + 1 < xs.length; i++) {
    const column: (typeof routes)[number][] = [];
    for (let j = 0; j + 1 < ys.length; j++) {
      const archive = terrainTileArchive(areas, layer, z, xs[i], ys[j]);
      // At the zoom routing starts a tile is never absent.
      if (archive === "absent") continue;
      const last = column[column.length - 1];
      if (last?.archive === archive && last.tiles[3] === ys[j] - 1)
        last.tiles[3] = ys[j + 1] - 1;
      else
        column.push({
          archive,
          tiles: [xs[i], ys[j], xs[i + 1] - 1, ys[j + 1] - 1],
        });
    }
    const next = new Map<string, (typeof routes)[number]>();
    for (const route of column) {
      const id = route.archive === "statewide" ? "" : route.archive.id;
      const key = `${id}/${route.tiles[1]}/${route.tiles[3]}`;
      const left = previous.get(key);
      if (left) {
        left.tiles[2] = route.tiles[2];
        next.set(key, left);
      } else {
        routes.push(route);
        next.set(key, route);
      }
    }
    previous = next;
  }
  return routes.map((r) => ({
    archive: r.archive,
    tiles: r.tiles as unknown as TileRect,
  }));
}

/**
 * A rectangle's `[west, south, east, north]` for a TileJSON, drawn in by a
 * hair: MapLibre counts a tile whose edge touches the bounds as inside, so
 * exact edges would draw the neighbouring row twice.
 */
export function tileRectBounds(
  z: number,
  [x0, y0, x1, y1]: TileRect,
): [number, number, number, number] {
  const n = 2 ** z;
  const lon = (x: number) => (x / n) * 360 - 180;
  const lat = (y: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const inset = 1e-7;
  return [
    lon(x0) + inset,
    lat(y1 + 1) + inset,
    lon(x1 + 1) - inset,
    lat(y0) - inset,
  ];
}

/**
 * The tiles at `z` that `[west, south, east, north]` touches, inclusive: the
 * inverse of `tileRectBounds`, so a rectangle saved as its bounds reads back
 * as itself (terrainRoutes.test.ts).
 */
export function tileRectCovering(
  z: number,
  [west, south, east, north]: readonly [number, number, number, number],
): TileRect {
  const nw = lonLatToTile(west, north, z);
  const se = lonLatToTile(east, south, z);
  return [nw.x, nw.y, se.x, se.y];
}
