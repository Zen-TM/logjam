// The status badge on a place pin: a person for a shared place, a tick for a
// visited one (never both, `placeStatus`). Both clients draw it from these
// images with an ordinary symbol layer; the layer's own style stays with each
// client, as for `gaugeIcon.ts`.
import {
  PLACE_BADGE_SHARED_URI,
  PLACE_BADGE_VISITED_URI,
} from "./placeBadgeImages.js";

/** Style-image names. Registered once per map, by whatever owns the style. */
export const PLACE_BADGE_SHARED_IMAGE = "place-badge-shared";
export const PLACE_BADGE_VISITED_IMAGE = "place-badge-visited";

export const PLACE_BADGE_URIS = {
  [PLACE_BADGE_SHARED_IMAGE]: PLACE_BADGE_SHARED_URI,
  [PLACE_BADGE_VISITED_IMAGE]: PLACE_BADGE_VISITED_URI,
} as const;

/**
 * `icon-size` for a badge 12 px across (the 128 px source holds a 120 px disc),
 * beside a pin whose dot has radius `PLACE_BADGE_PIN_RADIUS`. A client that
 * scales its pin with zoom multiplies this by radius / PLACE_BADGE_PIN_RADIUS,
 * and the offset below follows, since MapLibre scales `icon-offset` by size.
 */
export const PLACE_BADGE_SIZE = 0.1;
export const PLACE_BADGE_PIN_RADIUS = 6;

/**
 * `icon-offset` in source pixels: the disc's centre sits on the pin's
 * upper-right, 7.8 px from the dot's centre at the base size, so it overlaps
 * the pin's rim by a little and still stands clear of an owned pin drawn on
 * the same coordinate.
 */
export const PLACE_BADGE_OFFSET: [number, number] = [55, -55];
