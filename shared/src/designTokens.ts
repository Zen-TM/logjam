// Scheme-INDEPENDENT design tokens, shared by Logjam GPS and Logjam Web.
//
// The theme schemes (`themeSchemes.ts`) own the surfaces and text; the hues
// here encode WHAT A THING IS, which does not change with the user's theme —
// and they must read the same on both clients, or a GeoPDF is clay on the
// phone and blue in the browser. Every foreground/background pair built from
// these is measured under every scheme by `scripts/wcag-contrast.mjs`.
//
// The scales below (space, type, control sizes, motion, opacity) are declared
// once for both clients under the same names. Where a value differs it is
// because the MEDIUM differs (a mouse on a desktop vs a finger on a phone),
// and the declaration is split by medium to say so. Logjam Web reads all of
// it from the generated `frontend/src/tokens.generated.css` (`webTokens.ts`).
import { SHARED_PLACE_COLOR } from "./placeTypes.js";

/**
 * The label and glyph colour for anything drawn ON a colour fill — an active
 * chip, a filled button, a hue tile. Every scheme's `onFill` is this ink, not
 * its page colour: the old dark page clears 4.5:1 on the accent and the light
 * place-type palette, which is why it looked like the rule, but on the shared
 * heath it is 3.7:1 (Sandstone) and on the GeoPDF hue 2.7:1. One dark ink
 * clears every fill, in the light scheme too.
 */
export const INK = "#1E1B18";

/**
 * What is drawn ON THE MAP in a dark of its own — a place's name label, the
 * halo behind it, the casing under a line — is drawn on the BASEMAP, not on
 * the page, so it never follows the scheme: a light scheme's dark text on a
 * light halo would vanish into a satellite image. Sandstone's values, fixed.
 */
export const MAP_INK = {
  /** A label drawn on the map. */
  label: "#F7F3EC",
  /** The halo behind a map label, and the casing that sets a line off any basemap. */
  casing: "#4E4944",
} as const;

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

/**
 * Spacing steps (8 × n), named by n. The one scale both clients lay out with:
 * Logjam GPS's `spacing(n)`, Logjam Web's `--space-<n>` (`--space-1-5` is 12).
 * A value off these steps is a decision to leave the system, and needs saying.
 */
export const SPACE_UNIT = 8;
export const SPACE = {
  "0.5": 4,
  "1": 8,
  "1.5": 12,
  "2": 16,
  "3": 24,
  "4": 32,
  "6": 48,
} as const;

/**
 * The rhythm of a form, in px: how far a label sits from its control, one field
 * from the next, and a section heading from what is above it. Both clients lay
 * a form out with these three and no others (Logjam GPS's `Field`/`FormStack`
 * and `SectionHeader`, Logjam Web's `--form-*` properties), so a control never
 * sits a label's distance from the chips above it. Guard: `FORM_RHYTHM` in
 * `designTokens.test.ts` holds the order label < field < section.
 */
export const FORM_RHYTHM = {
  /** A label, a hint or an error to the control it is about. */
  label: SPACE["0.5"],
  /** One field (label, control, hint, error) to the next. */
  field: SPACE["1.5"],
  /** The space above a section heading, which divides two groups of fields. */
  section: SPACE["2"],
} as const;

/**
 * Type sizes in px, by medium. Logjam GPS is read at arm's length on a phone;
 * Logjam Web is a desktop density, a step smaller, emitted in rem so a browser
 * text-size setting reaches every label. 12 is the floor on both. `display`
 * (a screen's one hero metric) is Logjam GPS only: no web page has one.
 */
export const FONT = {
  gps: { xs: 12, sm: 14, base: 16, lg: 20, xl: 24, display: 34 },
  web: { xs: 12, sm: 13, base: 14, lg: 18, xl: 20 },
} as const;

/** Type weights, the same on both media. */
export const FONT_WEIGHT = { regular: 400, medium: 600, bold: 700 } as const;

/**
 * Type roles: which size and weight each kind of text takes, by client. A role
 * names a size from `FONT` and a weight from `FONT_WEIGHT`, so the scale stays
 * the one list of numbers; Logjam GPS reads them as `textRole.<name>` (theme.ts)
 * and Logjam Web as `--text-<name>-size|weight|transform` (webTokens.ts). A
 * client that does not draw a role has no entry for it. Colour is the screen's
 * choice among `text` and `textMuted` (`muted` marks the roles that are always
 * the second), never a role's.
 */
type TextRoleStyle<Size extends string> = {
  size: Size;
  weight: keyof typeof FONT_WEIGHT;
  /** A section heading; shared/DESIGN.md §2. */
  uppercase?: true;
  muted?: true;
};
type TextRoleSpec = {
  gps?: TextRoleStyle<keyof typeof FONT.gps>;
  web?: TextRoleStyle<keyof typeof FONT.web>;
};
export const TEXT_ROLES = {
  /** A screen's or a page's own title. */
  title: {
    gps: { size: "xl", weight: "bold" },
    web: { size: "xl", weight: "bold" },
  },
  /** A sheet's, dialog's or side sheet's title. */
  sheetTitle: {
    gps: { size: "lg", weight: "bold" },
    web: { size: "lg", weight: "medium" },
  },
  /** The one figure a hero carries. */
  metric: {
    gps: { size: "lg", weight: "medium" },
    web: { size: "lg", weight: "medium" },
  },
  /** A figure in a grid of stats. */
  statValue: {
    gps: { size: "lg", weight: "bold" },
    web: { size: "lg", weight: "medium" },
  },
  /** A row's title. */
  rowTitle: {
    gps: { size: "base", weight: "medium" },
    web: { size: "base", weight: "medium" },
  },
  /** What a row says under its title. */
  subtitle: {
    gps: { size: "sm", weight: "regular", muted: true },
    web: { size: "sm", weight: "regular", muted: true },
  },
  /** The label of a field or a control: sentence case, never a heading. */
  label: {
    gps: { size: "sm", weight: "regular", muted: true },
    web: { size: "sm", weight: "regular", muted: true },
  },
  /** A line under a control saying what it means. */
  hint: {
    gps: { size: "sm", weight: "regular", muted: true },
    web: { size: "xs", weight: "regular", muted: true },
  },
  /** A section heading or a stat caption: the only capitals. */
  section: {
    gps: { size: "xs", weight: "medium", uppercase: true, muted: true },
    web: { size: "xs", weight: "medium", uppercase: true, muted: true },
  },
} as const satisfies Record<string, TextRoleSpec>;

/**
 * Control heights in px, by pointer: `lg` buttons and text fields, `md`
 * compact buttons, chips and icon buttons, `sm` the round icon button at a
 * pill's end. A mouse keeps the desktop density (still clear of WCAG 2.5.8's
 * 24px); a finger gets the touch set, on Logjam GPS and on a coarse-pointer
 * browser alike.
 */
export const CONTROL = {
  web: { lg: 36, md: 32, sm: 24 },
  touch: { lg: 48, md: 40, sm: 32 },
} as const;

/** Every pressable's hit area on a touch screen, visual size plus slop. */
export const TOUCH_TARGET_MIN = 48;

/** Transition durations in ms. */
export const MOTION = { fast: 150, med: 200 } as const;

/** Opacity of a control that exists but cannot be used right now. */
export const OPACITY = { disabled: 0.5 } as const;
