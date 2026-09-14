// Scheme-INDEPENDENT design tokens, shared by Logjam GPS and Logjam Web.
//
// The four theme schemes (`themeSchemes.ts`) own the surfaces and text; the
// values here encode WHAT A THING IS, which does not change with the user's
// theme — and they must read the same on both clients, or a GeoPDF is clay on
// the phone and blue in the browser. Every foreground/background pair built
// from these is measured under all four schemes by `scripts/wcag-contrast.mjs`.
import { SHARED_PLACE_COLOR } from "./placeTypes.js";

/**
 * The label and glyph colour for anything drawn ON a colour fill — an active
 * chip, a filled button, a hue tile. Fixed, not the scheme's `primary`:
 * `primary` clears 4.5:1 on the accent and the light place-type palette, which
 * is why it looked like the rule, but on the shared heath it is 3.7:1
 * (Sandstone) and on the GeoPDF hue 2.7:1. One dark ink clears every fill.
 */
export const INK = "#1E1B18";

/**
 * Per-kind identity hues for map material and the things you draw on it.
 * Mid-light and muted, drawn from the NSW place palette (rock, scrub, water,
 * heath) — never a saturated web primary. Downloaded basemap REGIONS take the
 * scheme's accent instead, so they are not here.
 */
export const ASSET_HUES = {
  /** Topo overlays (contours, slope, vegetation) — eucalypt leaf. */
  overlay: "#9DBE8B",
  /** GeoPDF maps — fired clay, a lifted cousin of the sandstone rust. Lifted
   *  from #C97B4A (2026-09-13): 2.72:1 as a glyph on Sandstone; and again from
   *  #CE885C (2026-09-14): 2.54:1 as a chip glyph on a Sandstone card, where
   *  the bikepacking trip type borrows it. */
  geoPdf: "#D99B72",
  /** Routes you drew — she-oak green, distinct from the imported-file blue
   *  because a route is authored rather than brought in. */
  route: "#8FBFA6",
  /** Imported files (GPX/KML/GeoJSON) — waterhole blue. */
  import: "#86B5D4",
  /** Recorded tracks — heath flower. */
  track: "#B79EC0",
  /** Marked points — waratah, the most forward colour in the muted range: a
   *  waypoint is a thing you are trying to FIND again. Lifted from #D4715E
   *  (2026-09-13): 2.68:1 as a glyph on Sandstone. */
  waypoint: "#D98170",
} as const;

/**
 * Hues for trip types the USER typed, picked by a hash of the label
 * (`tripTypeIdentity`). The seeded activities borrow asset hues and canyoning
 * takes the accent; these are the rest. Same palette rule as `ASSET_HUES`.
 */
export const TRIP_TYPE_OPEN_HUES = {
  heath: "#B79EC0",
  dryGrass: "#C9B37B",
  lichen: "#8FBFAE",
  waratah: "#D3A0A0",
  ridge: "#A9B4CE",
} as const;

/**
 * Place status hues. `done` is absent on purpose: a place you have visited
 * wears the scheme's own accent, because that is the win.
 */
export const PLACE_STATUS_HUES = {
  /** On the list, not yet visited — dry sandstone, the resting state. */
  todo: "#C7B39A",
  /** Shared with you by a friend — the one hue reserved for "shared". */
  shared: SHARED_PLACE_COLOR,
} as const;

/** Corner radii. `pill` is the fully rounded end (chips, meters, badges). */
export const RADIUS = { sm: 4, md: 8, lg: 12, xl: 16, pill: 999 } as const;
