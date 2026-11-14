import {
  regionInView,
  wrapView,
  type LonLatBox,
  type Region,
} from "@logjam/shared";

/**
 * The region the map draws after it moved to `bounds`: what `regionInView`
 * names for them, and `previous` itself while that is the same region, so a
 * pan inside one region changes nothing that reads it. Guard:
 * `viewRegion.test.ts`.
 */
export function nextViewRegion(
  previous: Region | null,
  bounds: LonLatBox,
): Region | null {
  const next = regionInView(wrapView(bounds));
  return next?.id === previous?.id ? previous : next;
}
