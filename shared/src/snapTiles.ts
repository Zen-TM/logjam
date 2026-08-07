// Where snapping gets its trail and creek geometry.
//
// Reads the Protomaps PMTiles archive DIRECTLY, at a fixed zoom, over the bbox
// spanning the segment being drawn.
//
// The obvious alternative — asking the live map what it has rendered — is what
// this replaces, and it was the cause of every snapping complaint. A rendered
// map only holds tiles for the current viewport at the current zoom, so a way
// that continued off-screen arrived truncated: the graph lost its middle and
// A* either refused or routed the long way round. It also chained snapping to
// the vector basemap being the active one, and to being zoomed in far enough.
// Measured against complete tiles the same algorithm refuses 0% of segments
// and returns the optimal path 99% of the time, so the data source was the
// whole fault.
//
// Reading the archive instead is independent of zoom, of the active basemap,
// and of what happens to be on screen.
//
// WHY NOT OVERPASS: real OSM would give true topology (shared node ids) rather
// than geometry we have to re-stitch. But every query would ship a canyon-area
// bounding box to a third-party server, which is exactly what this project's
// privacy rules forbid. The archive is our own, and on web it is same-origin.
//
// PRIVACY: the bbox is derived from where the user is drawing. It never leaves
// as a query — it only selects which tiles to range-request from our own CDN,
// and nothing here logs.

import { PMTiles } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

import type { RoutePoint } from "./routeValidation.js";
import type { SnapLine, SnapMode } from "./snapToPath.js";

/**
 * Zoom to read ways at. The archive's max is 15, and detail falls off a cliff
 * below 14 — a canyoning tile at z12 carries one "river" and no streams at
 * all, where z15 carries several streams and every path. Fixed rather than
 * following the camera: that coupling is the bug this module exists to remove.
 */
export const SNAP_TILE_ZOOM = 15;

/**
 * Margin around the segment's bbox, so a way that bulges outside the straight
 * line between the two taps is still in the graph. A switchback leaves the
 * corridor between its ends by exactly this sort of distance.
 */
export const SNAP_BBOX_MARGIN_M = 400;

/**
 * Ceiling on tiles fetched for one segment. A z15 tile is roughly 1.2 km
 * across at NSW latitudes, so this covers a segment several kilometres long.
 * Beyond it the user is drawing a line far longer than snapping can sensibly
 * follow, and we decline rather than issue a hundred range requests.
 */
export const SNAP_MAX_TILES = 25;

/** Protomaps schema: OSM paths/tracks, and flowing water. */
const TRAIL_KINDS = ["path"];
const WATERWAY_KINDS = ["stream", "river", "canal"];

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

/** Which vector-tile layer each kind lives in. */
const LAYER_FOR_KIND: Record<string, string> = {
  path: "roads",
  stream: "water",
  river: "water",
  canal: "water",
};

function tileX(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function tileY(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      2 ** zoom,
  );
}

/**
 * Archives are cached per URL: the PMTiles object holds the header and
 * directory pages, so re-creating it per segment would re-fetch them on every
 * tap. This is the difference between one range request per tap and four.
 */
const archives = new Map<string, PMTiles>();

function archiveFor(url: string): PMTiles {
  const existing = archives.get(url);
  if (existing) return existing;
  const archive = new PMTiles(url);
  archives.set(url, archive);
  return archive;
}

/**
 * Decoded ways per tile, keyed "url|z/x/y". Drawing a route means many taps
 * over the same handful of tiles, so this turns all but the first into a
 * memory read. Bounded because a long session pans across a lot of ground.
 */
const MAX_CACHED_TILES = 64;
const tileCache = new Map<string, { kind: string; coords: RoutePoint[] }[]>();

function cacheTile(
  key: string,
  lines: { kind: string; coords: RoutePoint[] }[],
) {
  if (tileCache.size >= MAX_CACHED_TILES) {
    const oldest = tileCache.keys().next();
    if (!oldest.done) tileCache.delete(oldest.value);
  }
  tileCache.set(key, lines);
}

/** Test seam — the caches are module-scoped and would leak between tests. */
export function clearSnapTileCache() {
  tileCache.clear();
  archives.clear();
}

async function linesInTile(
  archiveUrl: string,
  x: number,
  y: number,
): Promise<{ kind: string; coords: RoutePoint[] }[]> {
  const key = `${archiveUrl}|${SNAP_TILE_ZOOM}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;

  const result = await archiveFor(archiveUrl).getZxy(SNAP_TILE_ZOOM, x, y);
  const lines: { kind: string; coords: RoutePoint[] }[] = [];
  if (result) {
    const tile = new VectorTile(new PbfReader(new Uint8Array(result.data)));
    for (const layerName of ["roads", "water"]) {
      const layer = tile.layers[layerName];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        const kind = feature.properties.kind;
        if (typeof kind !== "string" || LAYER_FOR_KIND[kind] !== layerName) {
          continue;
        }
        const geometry = feature.toGeoJSON(x, y, SNAP_TILE_ZOOM).geometry;
        // Lines only. A lake or a reservoir is a water POLYGON and is not
        // something to route along.
        if (geometry.type === "LineString") {
          lines.push({ kind, coords: geometry.coordinates as RoutePoint[] });
        } else if (geometry.type === "MultiLineString") {
          for (const part of geometry.coordinates) {
            lines.push({ kind, coords: part as RoutePoint[] });
          }
        }
      }
    }
  }
  // An absent tile caches as empty: ocean and out-of-extent ground are common
  // and re-requesting them on every tap would be the slowest thing here.
  cacheTile(key, lines);
  return lines;
}

/**
 * Candidate ways for the segment between two points.
 *
 * Returns [] when snapping is off, when the span needs more tiles than
 * SNAP_MAX_TILES, or when the archive can't be reached (offline). All three
 * are normal outcomes that the caller renders as the straight line it would
 * have drawn anyway — never an error to surface mid-draw.
 */
export async function fetchSnapLines(
  archiveUrl: string,
  mode: SnapMode,
  from: RoutePoint,
  to: RoutePoint,
): Promise<SnapLine[]> {
  const kinds = new Set(snapKindsFor(mode));
  if (kinds.size === 0) return [];

  // Margin in degrees. Latitude is constant; longitude widens towards the
  // poles, so it is scaled by cos(lat) to stay a true distance.
  const marginLat = SNAP_BBOX_MARGIN_M / 111_320;
  const midLat = (from[1] + to[1]) / 2;
  const marginLon =
    marginLat / Math.max(0.01, Math.cos((midLat * Math.PI) / 180));

  const minX = tileX(Math.min(from[0], to[0]) - marginLon, SNAP_TILE_ZOOM);
  const maxX = tileX(Math.max(from[0], to[0]) + marginLon, SNAP_TILE_ZOOM);
  // Tile Y runs south as it increases, so the northern edge gives the minimum.
  const minY = tileY(Math.max(from[1], to[1]) + marginLat, SNAP_TILE_ZOOM);
  const maxY = tileY(Math.min(from[1], to[1]) - marginLat, SNAP_TILE_ZOOM);

  const tileCount = (maxX - minX + 1) * (maxY - minY + 1);
  if (tileCount > SNAP_MAX_TILES) return [];

  const coordinates: { x: number; y: number }[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) coordinates.push({ x, y });
  }

  try {
    const perTile = await Promise.all(
      coordinates.map(({ x, y }) => linesInTile(archiveUrl, x, y)),
    );
    return perTile
      .flat()
      .filter((line) => kinds.has(line.kind))
      .map(({ coords }) => ({ coords }));
  } catch {
    // Offline, or the archive is unreachable. Straight line, no noise.
    return [];
  }
}
