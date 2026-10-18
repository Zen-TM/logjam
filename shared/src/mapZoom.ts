// Camera zoom to ground resolution, for both clients' maps.
//
// MapLibre's camera zoom is 512-BASED, on Logjam Web (GL JS) and Logjam GPS
// (Native) alike: the world is `512 · 2^zoom` pixels across, not
// `256 · 2^zoom` (the slippy-tile convention). A raster source declaring
// `tileSize: 256` is served its z+1 tiles to compensate, but the camera's zoom
// is still the 512-based one, so ground resolution divides by 512. The
// 256-based 156543.034 constant would make every distance read double: Logjam
// GPS's scale bar would lie and Logjam Web's GeoPDF frame would cover half the
// ground it says. Guard: mapZoom.test.ts.
export const MAP_WORLD_PX_Z0 = 512;

const EQUATOR_METERS_PER_PIXEL_Z0 = 40075016.686 / MAP_WORLD_PX_Z0;

/**
 * Ground metres per pixel (a CSS pixel on Logjam Web, a DP on Logjam GPS) at
 * a MapLibre CAMERA zoom. A slippy-tile zoom is off by exactly 2x: Logjam
 * GPS's `tileMetersPerPixel` is for that.
 */
export function metersPerPixel(latitudeDeg: number, zoom: number): number {
  if (!Number.isFinite(latitudeDeg) || Math.abs(latitudeDeg) > 90) {
    throw new Error(`metersPerPixel: latitude out of range (${latitudeDeg})`);
  }
  if (!Number.isFinite(zoom) || zoom < 0) {
    throw new Error(`metersPerPixel: zoom out of range (${zoom})`);
  }
  return (
    (EQUATOR_METERS_PER_PIXEL_Z0 * Math.cos((latitudeDeg * Math.PI) / 180)) /
    2 ** zoom
  );
}
