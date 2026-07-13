// Pure tile-grid / Mercator math for the GeoPDF render path.
//
// Extracted from generateGeoPdf.ts so the projection math (the part most prone
// to silent edge-case errors at high zoom / extreme latitude) is unit-testable
// without pulling in canvas, PDFKit, PMTiles, AWS, or Prisma. generateGeoPdf
// imports these; rendering stays there.

const DEG_TO_RAD = Math.PI / 180;

/** Web-Mercator tile size in pixels. */
export const TILE_SIZE = 256;

// Reference DPI for zoom selection — this sets how many source pixels per mm
// we aim for, which determines the tile zoom level. Used both by the renderer
// (generateGeoPdf.ts) and by the runtime-size estimator (geoPdfNativeMegapixels).
export const TARGET_DPI = 300;

const MIN_ZOOM = 8;

/** Compute the tile zoom level that provides at least 1 source pixel per output pixel */
export function computeZoom(
  scale: number,
  latDeg: number,
  dpi: number,
  maxNativeZoom: number,
): number {
  const cosLat = Math.cos(Math.abs(latDeg) * DEG_TO_RAD);
  const z = Math.log2((156543.03 * cosLat * dpi) / (scale * 0.0254));
  return Math.max(MIN_ZOOM, Math.min(maxNativeZoom, Math.ceil(z)));
}

export type TileCoord = { x: number; y: number; z: number };

/** Transform mapping tile-grid pixel space to output mapCanvas pixel space. */
export interface TileToMapTransform {
  minTileX: number;
  minTileY: number;
  tiles: TileCoord[];
  offsetX: number; // pixel offset within tile grid where extent starts
  offsetY: number;
  scaleX: number; // ratio: output pixels / source pixels
  scaleY: number;
  /** Native source width in pixels (before scaleX) — used to size the canvas */
  srcW: number;
  /** Native source height in pixels (before scaleY) — used to size the canvas */
  srcH: number;
}

/** Spherical Mercator Y (same scale as Web Mercator tile math) */
export function latToMercY(lat: number): number {
  const s = Math.sin(lat * DEG_TO_RAD);
  return 0.5 * Math.log((1 + s) / (1 - s));
}

/** Convert longitude to tile X index at given zoom */
export function lon2tileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

/** Convert latitude to tile Y index at given zoom */
export function lat2tileY(lat: number, z: number): number {
  const latRad = lat * DEG_TO_RAD;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, z),
  );
}

/** Convert tile X index to longitude (west edge) */
export function tileX2lon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

/** Convert tile Y index to latitude (north edge) */
export function tileY2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Compute the transform from tile-grid pixel space to output canvas pixel space.
 *
 * The Y axis uses spherical Mercator (latToMercY) so the output canvas matches
 * the same projection as the tile grid and as the web-map frame the user drew.
 */
export function computeTileToMapTransform(
  zoom: number,
  north: number,
  south: number,
  east: number,
  west: number,
  widthPx: number,
  heightPx: number,
): TileToMapTransform {
  const minTileX = lon2tileX(west, zoom);
  const maxTileX = lon2tileX(east, zoom);
  const minTileY = lat2tileY(north, zoom);
  const maxTileY = lat2tileY(south, zoom);

  const tiles: TileCoord[] = [];
  for (let y = minTileY; y <= maxTileY; y++) {
    for (let x = minTileX; x <= maxTileX; x++) {
      tiles.push({ x, y, z: zoom });
    }
  }

  const tileGridW = (maxTileX - minTileX + 1) * TILE_SIZE;
  const tileGridH = (maxTileY - minTileY + 1) * TILE_SIZE;

  const tileOriginLon = tileX2lon(minTileX, zoom);
  const tileOriginLat = tileY2lat(minTileY, zoom);
  const tileEndLon = tileX2lon(maxTileX + 1, zoom);
  const tileEndLat = tileY2lat(maxTileY + 1, zoom);

  // X axis: longitude is linear in Mercator X — standard linear interpolation is correct.
  const offsetX =
    ((west - tileOriginLon) / (tileEndLon - tileOriginLon)) * tileGridW;
  const srcW = ((east - west) / (tileEndLon - tileOriginLon)) * tileGridW;

  // Y axis: use Mercator Y so the canvas projection matches the tile grid.
  const mY_origin = latToMercY(tileOriginLat);
  const mY_end = latToMercY(tileEndLat);
  const mY_north = latToMercY(north);
  const mY_south = latToMercY(south);

  const offsetY = ((mY_origin - mY_north) / (mY_origin - mY_end)) * tileGridH;
  const srcH = ((mY_north - mY_south) / (mY_origin - mY_end)) * tileGridH;

  return {
    minTileX,
    minTileY,
    tiles,
    offsetX,
    offsetY,
    scaleX: widthPx / srcW,
    scaleY: heightPx / srcH,
    srcW,
    srcH,
  };
}

/** Native render-canvas size in megapixels for a GeoPDF config — the size
 * signal for the adaptive runtime estimator. Paper-independent: depends only
 * on extent, scale and the base layer's max native zoom. */
export function geoPdfNativeMegapixels(
  extent: { north: number; south: number; east: number; west: number },
  scale: number,
  maxNativeZoom: number,
): number {
  const { north, south, east, west } = extent;
  const zoom = computeZoom(scale, (north + south) / 2, TARGET_DPI, maxNativeZoom);
  const t = computeTileToMapTransform(zoom, north, south, east, west, 1, 1);
  return (t.srcW * t.srcH) / 1e6;
}
