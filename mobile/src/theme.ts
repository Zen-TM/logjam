// Design tokens — sourced from the shared theme schemes (single source of
// truth for both clients; MOBILE_DESIGN_BRIEF §4).
//
// The user's scheme (`uiPreferences.themeSchemeId`) is resolved HERE, at module
// evaluation, from a synchronous on-device preference — because everything
// derived from it (`surface`, `assetHue`, `canyonHue`, and the ~45 files whose
// `StyleSheet.create` reads these tokens) is a module constant snapshotted at
// import time. That is also why a change applies at the next launch rather
// than repainting the running app: see `persistThemeSchemeId` and DESIGN.md §12.
import {
  DEFAULT_THEME_SCHEME_ID,
  isThemeSchemeId,
  THEME_SCHEMES,
  type ThemeSchemeId,
  type ThemeTokens,
} from "@logjam/shared";

import { readPref, writePref } from "./prefsDb";

const THEME_SCHEME_PREF_KEY = "themeSchemeId";

function resolveSchemeId(): ThemeSchemeId {
  const stored = readPref(THEME_SCHEME_PREF_KEY);
  // An unrecognised id (downgraded app, hand-edited row) falls back rather than
  // crashing the whole style layer on a bad string.
  return isThemeSchemeId(stored) ? stored : DEFAULT_THEME_SCHEME_ID;
}

/** The scheme this launch is painted in. */
export const activeThemeSchemeId: ThemeSchemeId = resolveSchemeId();

export const theme: ThemeTokens = THEME_SCHEMES[activeThemeSchemeId].tokens;

/**
 * Record the scheme for the NEXT launch. Returns false when the device refused
 * to store it, so the caller can say so instead of showing a selection that
 * silently reverts.
 *
 * The account-level copy (`PATCH /users/me`) is the caller's job — that one is
 * what makes the choice follow the user to the web and to another phone; this
 * one is what makes the app open in the right colours with no network.
 */
export function persistThemeSchemeId(id: ThemeSchemeId): boolean {
  return writePref(THEME_SCHEME_PREF_KEY, id);
}

// Spacing/radius/type scale mirroring the web tokens (frontend/src/index.css).
// `pill` is the fully-rounded end of the scale (chips, meters, badges).
export const radius = { sm: 4, md: 8, lg: 12, xl: 16, pill: 999 } as const;
export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 20,
  xl: 24,
  /** Hero metric — one per screen, never body copy. */
  display: 34,
} as const;
export const spacing = (n: number): number => n * 8;

// Weight + line-height scales so type roles are consistent across screens
// (page title = xl/bold, body = base/regular at body line-height). RN wants
// weights as strings.
export const fontWeight = { regular: "400", medium: "600", bold: "700" } as const;
export const lineHeight = { body: 22, tight: 18 } as const;

// Modal/sheet scrims — the only intentional black-alpha overlays. Everything
// else derives from the scheme. `light` for bottom sheets, `heavy` for
// full-screen edit modals, `photo` for the full-res photo viewer (a photo is
// judged against black, and any scheme tint here reads as a colour cast).
export const scrim = {
  light: "rgba(0,0,0,0.5)",
  heavy: "rgba(0,0,0,0.6)",
  photo: "rgba(0,0,0,0.92)",
} as const;

// Default touch-target padding for small text/icon actions.
export const hitSlop = 8;

// Surface tokens for cards/sheets layered above the primary background. Derived
// from the active scheme (not white-alpha overlays) so all four themes stay
// warm and coherent: `card` sits one step lighter than `primary`, `border` a
// hair lighter again for a subtle edge.
export const surface = {
  card: theme.secondary,
  cardPressed: theme.bonus2,
  border: theme.bonus2,
} as const;

// Hex + alpha → rgba(). Lets a category hue tint a surface (icon tile, meter
// track, chip fill) without adding a second colour token per hue. Hex only
// (#rgb or #rrggbb) — the only colour form the token set uses.
export function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (full.length !== 6) throw new Error(`withAlpha expects a hex colour, got "${hex}"`);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * ASSET HUES — per-kind identity colours for on-device map assets.
 *
 * Deliberately scheme-INDEPENDENT: these encode *what a thing is* (a region vs
 * a track), which does not change when the user picks a different theme, and
 * they must stay mutually distinguishable — a per-scheme remap would collapse
 * them into each scheme's narrow hue range. All four schemes have a dark
 * background (#4E4944 / #2B3F52 / #2F4F3E / #2B3A3F), so mid-light hues
 * (~65-80% lightness, moderate saturation) carry enough contrast on every one.
 *
 * `region` reuses the active scheme's accent, so the largest, most common
 * asset class always feels native to the chosen theme.
 *
 * Rule for adding one: mid-light, muted, and drawn from the NSW canyon
 * palette (rock, scrub, water, heath) — never a saturated web primary.
 */
export const assetHue = {
  /** Downloaded basemap regions — the scheme's own accent. */
  region: theme.accent,
  /** Topo overlays (contours, slope, vegetation) — eucalypt leaf. */
  overlay: "#9DBE8B",
  /** GeoPDF maps — fired clay, a lifted cousin of the sandstone rust. */
  geoPdf: "#C97B4A",
  /** Routes you drew — she-oak green, distinct from the imported-file blue
   *  because a route is authored rather than brought in. */
  route: "#8FBFA6",
  /** Imported vector files (GPX/KML/GeoJSON) — waterhole blue. */
  vector: "#86B5D4",
  /** Recorded tracks — heath flower. */
  track: "#B79EC0",
} as const;

export type AssetHue = keyof typeof assetHue;

/**
 * Canyon status identity for the Canyons screen — the same hue on a row's icon
 * tile and on its filter chip, exactly as `assetHue` works for saved assets
 * (DESIGN.md §3). Scheme-independent for the same reason: a canyon you have run
 * is what it is regardless of the user's theme.
 */
export const canyonHue = {
  /** Run at least once — the scheme's own accent, because this is the win. */
  done: theme.accent,
  /** On the list, not yet run — dry sandstone, the resting state. */
  todo: "#C7B39A",
  /** Shared with you by a friend — heath flower: someone else's line. */
  shared: "#B79EC0",
} as const;

/**
 * Inbox identity — BORROWED, not invented (DESIGN.md §3). A notification is
 * always about something that lives somewhere else in the app, so it wears that
 * thing's hue: a topo notification is the same eucalypt as a topo overlay in
 * Saved, a canyon-share is the same heath as a shared canyon on the Canyons
 * screen. Recognising a thing again where it lives is what makes the inbox part
 * of the app rather than a log of unrelated events.
 *
 * Adding a kind means pointing at an existing hue. If the thing it refers to has
 * no hue yet, that is the gap to fill first.
 */
export const notificationHue = {
  /** A canyon shared with you — as on the Canyons rail. */
  share: canyonHue.shared,
  /** Friends and requests — the account class takes the scheme accent. */
  people: theme.accent,
  /** LiDAR topo jobs — as in Saved. */
  topo: assetHue.overlay,
  /** Topo exports — the waterhole blue of the vector files they produce. */
  export: assetHue.vector,
  /** GeoPDFs — as in Saved. */
  geoPdf: assetHue.geoPdf,
  /** Anything that failed or was skipped. The one place a hue means "look". */
  problem: theme.warning,
} as const;
