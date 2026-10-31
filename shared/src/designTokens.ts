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
 * its page colour: a scheme's dark page clears 4.5:1 on the accent and the light
 * place-type palette, but on the shared heath it is 3.7:1 (Sandstone) and on
 * the GeoPDF hue 2.7:1. One dark ink clears every fill, in the light scheme too.
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
  /** The ring round a point mark, which separates it from any basemap. */
  ring: "#FFFFFF",
  /** A river gauge's drop: one colour for every gauge, never scaled by reading. */
  gauge: "#3B82C4",
  /** The light halo behind a LiDAR topo's own label colour. */
  labelHalo: "rgba(255,255,255,0.8)",
} as const;

/** Names on the map, a place's and a gauge's, appear from this zoom on both
 *  clients: further out they would only collide. */
export const MAP_LABEL_MIN_ZOOM = 9;

/**
 * The location marker's colour options.
 *
 * Not a scheme colour and not an `ASSET_HUES` kind: a preference the user sets
 * for legibility against the ground they actually walk on — a blue arrow over
 * blue water is the complaint this exists to answer. Scheme-independent for
 * the same reason the asset hues are: the marker sits on a basemap, not on a
 * scheme surface.
 *
 * Every entry is mid-light and saturated enough to hold up on aerial imagery,
 * which is the busiest basemap here. The arrow keeps a white halo whatever is
 * picked (see MapScreen), so none of these has to carry its own contrast.
 */
export const MARKER_COLORS = {
  /** The original — the blue every mapping app trained the user on. */
  blue: "#4285F4",
  /** Warning-tape amber. Reads over water, scrub and imagery alike. */
  amber: "#F5A524",
  /** Signal red. The one people pick to find themselves fast. */
  red: "#F2635F",
  /** Fluoro green — a colour bushland does not contain. */
  green: "#4ADE80",
  /** Heath flower, as on the Places rail. */
  violet: "#C77DD6",
  /** No hue at all, for anyone who finds a coloured arrow noisy. */
  white: "#FFFFFF",
} as const;

export type MarkerColorId = keyof typeof MARKER_COLORS;

export const MARKER_COLOR_ORDER: readonly MarkerColorId[] = [
  "blue",
  "amber",
  "red",
  "green",
  "violet",
  "white",
];

/**
 * The black veils: `light` under a bottom sheet, `heavy` behind chrome drawn
 * over the map, `photo` behind a full-resolution photo (judged against black,
 * so no scheme tint). The only black-alpha overlays; everything else derives
 * from the scheme.
 */
export const SCRIM = {
  light: "rgba(0,0,0,0.5)",
  heavy: "rgba(0,0,0,0.6)",
  photo: "rgba(0,0,0,0.92)",
} as const;

/**
 * Words and glyphs drawn on a `SCRIM`. White in every scheme: the veil is
 * black whatever the scheme, so a scheme's dark `text` on it is near-zero
 * contrast. `scripts/wcag-contrast.mjs` measures it on `SCRIM.heavy` over a
 * white map.
 */
export const ON_SCRIM = "#FFFFFF";

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
   *  for contrast as a glyph on Sandstone and as a chip glyph on a Sandstone
   *  card, where the bikepacking trip type borrows it. */
  geoPdf: "#D99B72",
  /** Routes you drew — she-oak green, distinct from the imported-file blue
   *  because a route is authored rather than brought in. */
  route: "#8FBFA6",
  /** Imported files (GPX/KML/GeoJSON) — waterhole blue. */
  import: "#86B5D4",
  /** Recorded tracks — heath flower. */
  track: "#B79EC0",
  /** Marked points — waratah, the most forward colour in the muted range: a
   *  waypoint is a thing you are trying to FIND again. Lifted for contrast as
   *  a glyph on Sandstone. */
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

/**
 * The leaderboard's podium medals. Muted like every other hue here: old gold,
 * creek-stone grey, burnt copper. Not a status: a rank 4+ row wears none.
 */
export const MEDAL_HUES = {
  gold: "#D4B04C",
  silver: "#B4BCC4",
  bronze: "#C98A5B",
} as const;

/** Corner radii. `pill` is the fully rounded end (chips, meters, badges). */
export const RADIUS = { sm: 4, md: 8, lg: 12, xl: 16, pill: 999 } as const;

/**
 * Spacing steps (8 × n), named by n. The one scale both clients lay out with:
 * Logjam GPS's `spacing(n)`, Logjam Web's `--space-<n>` (`--space-1-5` is 12).
 * 2 is a hairline gap inside one object (a label over its figure); 6 is not a
 * step: inside one object take 4, between objects 8. Logjam GPS's `spacing()`
 * takes only a `SpaceStep`, so an off-scale value does not typecheck.
 */
export const SPACE_UNIT = 8;
export const SPACE = {
  "0.25": 2,
  "0.5": 4,
  "1": 8,
  "1.5": 12,
  "2": 16,
  "3": 24,
  "4": 32,
  "6": 48,
} as const;

/** A key of `SPACE` as the number `spacing(n)` is called with. */
export type SpaceStep = {
  [K in keyof typeof SPACE]: K extends `${infer N extends number}` ? N : never;
}[keyof typeof SPACE];

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
 * text-size setting reaches every label. The steps have the same names on both
 * and 12 is the floor on both: a role names a step, so it is the same step on
 * both clients and the scale is the only thing that differs between them.
 */
export const FONT = {
  gps: { xs: 12, sm: 14, base: 16, lg: 20, xl: 24 },
  web: { xs: 12, sm: 13, base: 14, lg: 18, xl: 20 },
} as const;

/** Type weights, the same on both media. */
export const FONT_WEIGHT = { regular: 400, medium: 600, bold: 700 } as const;

/**
 * Type roles: the one list of what a text can be, for both clients. A role is
 * a step of `FONT`, a weight from `FONT_WEIGHT`, and where it says so a line
 * height or capitals; nothing else. Colour is not a role: a text is muted, an
 * error or on a fill where it is drawn (shared/DESIGN.md §7). Logjam GPS reads
 * them as `textRole.<name>` (theme.ts) and Logjam Web as a class to
 * `composes:` (webTokens.ts).
 *
 * Two roles never have the same values (`designTokens.test.ts`): a new kind of
 * text takes the role that is its size and weight, and a role is added only
 * for a size and weight no role has.
 */
type TextRoleSpec = {
  size: keyof typeof FONT.gps & keyof typeof FONT.web;
  weight: keyof typeof FONT_WEIGHT;
  /** A section heading; shared/DESIGN.md §2. */
  uppercase?: true;
  /** Lines set apart so several read in a row: 22 dp on Logjam GPS
   *  (theme.ts), 1.5 on Logjam Web. A role without it takes the font's own. */
  leading?: true;
};
export const TEXT_ROLES = {
  /** A screen's or a page's own title. */
  title: { size: "xl", weight: "bold" },
  /** A sheet's, dialog's or side sheet's title, and the figure a hero or a
   *  stat cell leads with. */
  heading: { size: "lg", weight: "bold" },
  /** A row's title, and the name of anything a list is made of. */
  rowTitle: { size: "base", weight: "medium" },
  /** Running text: a sentence, a line of choice text, what the user types. */
  body: { size: "base", weight: "regular" },
  /** Prose the user reads over several lines: notes, consent text, an
   *  explanation of a screen. `body` with its lines set apart. */
  paragraph: { size: "base", weight: "regular", leading: true },
  /** The label of a chip, tab, button or small control. */
  control: { size: "sm", weight: "medium" },
  /** Any secondary line: what a row says under its title, a field's label, a
   *  hint, an error line, a value beside its label. */
  detail: { size: "sm", weight: "regular" },
  /** A count, qualifier or source beside or under another line, and the
   *  labels of a chart. */
  meta: { size: "xs", weight: "regular" },
  /** Text small enough to sit on the map or inside a pill: a status, a
   *  badge, initials. */
  caption: { size: "xs", weight: "medium" },
  /** A section heading or a stat caption: the only capitals. */
  section: { size: "xs", weight: "medium", uppercase: true },
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
