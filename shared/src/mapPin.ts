// A place pin's outline, the same on both clients: the type's colour, a casing
// ring in `MAP_INK.casing` that reads on light basemaps, and a white halo
// outside it that reads on dark and satellite ones. MapLibre's circle layer
// draws one stroke, so each client draws the halo as a white disc layer under
// the pin, `pinHaloRadius` across. The pairs are checked by
// `scripts/wcag-contrast.mjs` (mark edge against light land and satellite).
import { MAP_INK } from "./designTokens.js";

export const PIN_CASING_COLOR = MAP_INK.casing;
export const PIN_CASING_WIDTH = 1.5;
export const PIN_HALO_COLOR = MAP_INK.ring;
export const PIN_HALO_WIDTH = 1;

/** The halo disc's radius for a pin whose fill has radius `r`. A circle's
 *  stroke sits outside its radius, so the casing and halo both add to it. */
export function pinHaloRadius(r: number): number {
  return r + PIN_CASING_WIDTH + PIN_HALO_WIDTH;
}
