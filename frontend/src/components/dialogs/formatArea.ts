/**
 * Format a drawn-area size for display (TOPO-4). Sub-10 km² areas keep two
 * decimals so a small (< 0.5 km²) draw is visibly registered instead of
 * rendering as "0 km²"; anything at least 10 km² rounds to whole km² as
 * before. Areas that would still display as 0.00 show "<0.01 km²".
 */
export function formatAreaKm2(areaKm2: number): string {
  if (!Number.isFinite(areaKm2) || areaKm2 < 0) {
    throw new Error(`formatAreaKm2: invalid area ${areaKm2}`);
  }
  if (areaKm2 >= 10) return `${areaKm2.toFixed(0)} km²`;
  if (areaKm2 > 0 && areaKm2 < 0.005) return "<0.01 km²";
  return `${areaKm2.toFixed(2)} km²`;
}
