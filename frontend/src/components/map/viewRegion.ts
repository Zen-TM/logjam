import {
  accountRegion,
  pointBox,
  regionInWrappedView,
  type LonLatBox,
  type Region,
} from "@logjam/shared";

/**
 * The region the map draws after it moved to `bounds`: what
 * `regionInWrappedView` names for them, and `previous` itself while that is
 * the same region, so a pan inside one region changes nothing that reads it.
 * Guard: `viewRegion.test.ts`.
 */
export function nextViewRegion(
  previous: Region | null,
  bounds: LonLatBox,
): Region | null {
  const next = regionInWrappedView(bounds);
  return next?.id === previous?.id ? previous : next;
}

/**
 * Where the map starts, before it reports a view: the stored camera, else the
 * account's home region's opening view, as a point, and the region that point
 * is in. Seeding the region from it means the first render already knows what
 * the ground offers (Sharpen an area reads it), instead of reading "Not
 * available here" until the map has moved. Guard: `viewRegion.test.ts`
 * ("startingView").
 */
export function startingView(
  camera: { lat: number; lng: number } | null,
  preferences: Parameters<typeof accountRegion>[0],
): { box: LonLatBox; region: Region | null } {
  const box = camera
    ? pointBox(camera.lng, camera.lat)
    : pointBox(...accountRegion(preferences).view.center);
  return { box, region: nextViewRegion(null, box) };
}
