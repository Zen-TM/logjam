// The ground a screen pixel covers, for sizing the GeoPDF frame.

/**
 * Metres per CSS pixel at a zoom and latitude. MapLibre GL draws 512px tiles,
 * so zoom 0 is earthCircumference / 512 = 78271.52 m/px, NOT the 256-tile
 * 156543.03 Leaflet, Google and the server's XYZ tile maths use: that constant
 * is off by exactly one zoom level, and the frame would cover half the ground
 * it says it does (geoPdfFrame.test.ts).
 */
export function metresPerPixel(zoom: number, latDeg: number): number {
  return (78271.52 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * The frame's size on screen while a scale is kept: the paper's map area on
 * the ground, over the ground a pixel covers. Zooming changes this, never the
 * scale.
 */
export function keptFrameSizePx(
  scale: number,
  paperMm: { w: number; h: number },
  zoom: number,
  latDeg: number,
): { w: number; h: number } {
  const mpp = metresPerPixel(zoom, latDeg);
  return {
    w: (scale * paperMm.w) / 1000 / mpp,
    h: (scale * paperMm.h) / 1000 / mpp,
  };
}
