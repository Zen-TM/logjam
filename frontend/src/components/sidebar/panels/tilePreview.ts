export type TileLayer = { tiles: string[]; maxzoom: number };

function lonLatToTileXY(lng: number, lat: number, zoom: number) {
  const z = Math.floor(zoom);
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { z, x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

export function previewUrlFor(
  layer: TileLayer,
  view: { lng: number; lat: number; zoom: number },
): string {
  const clampedZoom = Math.min(Math.floor(view.zoom), layer.maxzoom);
  const { z, x, y } = lonLatToTileXY(view.lng, view.lat, clampedZoom);
  return layer.tiles[0]
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}
