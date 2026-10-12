// Design tokens — sourced from the shared theme schemes (single source of
// truth for both clients; MOBILE_DESIGN_BRIEF §4).
//
// The user's scheme (`uiPreferences.themeSchemeId`) is STATE: resolved here at
// module evaluation from a synchronous on-device preference, so the first frame
// is already in the right colours, and changed by `setThemeSchemeId`, which
// repaints the running app. Nothing scheme-dependent is a module constant: a
// component reads colours with `useTheme()` and styles with a `makeStyles`
// hook (DESIGN.md §1). Guard: `liveTheme.test.ts`.
import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import type { ImageStyle, TextStyle, ViewStyle } from "react-native";
import {
  ASSET_HUES,
  CONTROL,
  DEFAULT_THEME_SCHEME_ID,
  FONT,
  FONT_WEIGHT,
  FORM_RHYTHM,
  normalizeThemeSchemeId,
  OPACITY,
  PLACE_STATUS_HUES,
  RADIUS,
  SPACE_UNIT,
  type SpaceStep,
  TEXT_ROLES,
  THEME_SCHEMES,
  TOUCH_TARGET_MIN,
  type ThemeSchemeId,
  type ThemeTokens,
} from "@logjam/shared";

import { readPref, writePref } from "./prefsDb";

const THEME_SCHEME_PREF_KEY = "themeSchemeId";
const TEXT_SCALE_PREF_KEY = "textScale";

function resolveSchemeId(): ThemeSchemeId {
  const stored = readPref(THEME_SCHEME_PREF_KEY);
  // An unrecognised id (downgraded app, hand-edited row) falls back rather than
  // crashing the whole style layer on a bad string.
  return normalizeThemeSchemeId(stored) ?? DEFAULT_THEME_SCHEME_ID;
}

let currentThemeSchemeId = resolveSchemeId();
const schemeListeners = new Set<() => void>();
const subscribeToScheme = (listener: () => void) => {
  schemeListeners.add(listener);
  return () => void schemeListeners.delete(listener);
};

/**
 * Repaint the running app in `id`, and record it for the next launch. Returns
 * false when the device refused to store it (the repaint still happened), so
 * the caller can say the choice will not survive a restart.
 *
 * The account-level copy (`PATCH /users/me`) is the caller's job — that one is
 * what makes the choice follow the user to the web and to another phone; this
 * one is what makes the app open in the right colours with no network.
 */
export function setThemeSchemeId(id: ThemeSchemeId): boolean {
  if (id !== currentThemeSchemeId) {
    currentThemeSchemeId = id;
    for (const listener of schemeListeners) listener();
  }
  return writePref(THEME_SCHEME_PREF_KEY, id);
}

const ThemeSchemeContext = createContext<ThemeSchemeId>(currentThemeSchemeId);

/** Wraps the whole app (`index.ts`), above the error boundary: everything
 *  under it repaints when the scheme changes, and nothing remounts. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const id = useSyncExternalStore(
    subscribeToScheme,
    () => currentThemeSchemeId,
  );
  return createElement(ThemeSchemeContext.Provider, { value: id }, children);
}

/** The scheme the app is painted in right now. */
export const useThemeSchemeId = (): ThemeSchemeId =>
  useContext(ThemeSchemeContext);

/** The active scheme's colours, by role (`ThemeTokens` in `@logjam/shared`). */
export const useTheme = (): ThemeTokens =>
  THEME_SCHEMES[useThemeSchemeId()].tokens;

/** Whether the page is dark or light. The platform chrome follows it: the
 *  system bars' icons, the navigation theme. */
export const useThemeMode = () => THEME_SCHEMES[useThemeSchemeId()].mode;

/** One value per scheme, built the first time that scheme is asked for. */
function perScheme<T>(build: (theme: ThemeTokens) => T) {
  const built = new Map<ThemeTokens, T>();
  return (theme: ThemeTokens): T => {
    if (!built.has(theme)) built.set(theme, build(theme));
    return built.get(theme) as T;
  };
}

/**
 * A hook for anything derived from the scheme's colours: `build` runs once per
 * scheme, so the value keeps its identity from render to render and is safe as
 * a memo dependency or a prop. `textRole` is the type roles in that scheme
 * (the muted ones carry a colour).
 *
 *   const useToneColour = makeThemed((theme) => ({ ok: theme.accent }));
 */
export function makeThemed<T>(
  build: (theme: ThemeTokens, textRole: TextRoles) => T,
): () => T {
  const forScheme = perScheme((theme) => build(theme, textRolesFor(theme)));
  return () => forScheme(useTheme());
}

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * A component's styles, as a hook: `const useStyles = makeStyles((theme) =>
 * ({ … }))` at module scope, `const styles = useStyles()` in the component.
 * The sheet is built once per scheme, so a render allocates nothing.
 *
 * No `StyleSheet.create` inside: at runtime it only returns its argument, and
 * importing `react-native` here would break the node unit tests that reach
 * this module.
 */
export const makeStyles = <T extends NamedStyles<T> | NamedStyles<unknown>>(
  build: (theme: ThemeTokens, textRole: TextRoles) => T & NamedStyles<unknown>,
): (() => T) => makeThemed(build);

/**
 * TEXT SIZE — the user's multiplier, ON TOP OF the OS font scale.
 *
 * Android already has a font-size slider and RN honours it (`allowFontScaling`
 * is on by default), so this preference exists only for the gap that leaves:
 * someone who wants Logjam's type bigger without enlarging every other app.
 * Which means the two knobs MULTIPLY, and a user on OS 1.3 who picks 1.4 here
 * would be asking for 1.8× — enough to break the row layouts this app is built
 * out of. `resolveTextScale` therefore clamps the COMBINED figure to
 * `MAX_COMBINED_TEXT_SCALE` and returns what is left for us to apply.
 *
 * Applied at launch, unlike the scheme: the sizes in `textRole` are module
 * constants every style reads (DESIGN.md).
 */
export const TEXT_SCALES = [0.9, 1, 1.15, 1.3, 1.5] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

const DEFAULT_TEXT_SCALE: TextScale = 1;

/** Ceiling on OS scale × ours. Past this, a two-line row title is three lines. */
const MAX_COMBINED_TEXT_SCALE = 2;

/** The multiplier the user picked, whatever the OS is doing. */
export const chosenTextScale: TextScale = resolveChosenTextScale();

function resolveChosenTextScale(): TextScale {
  const stored = Number(readPref(TEXT_SCALE_PREF_KEY));
  return (TEXT_SCALES as readonly number[]).includes(stored)
    ? (stored as TextScale)
    : DEFAULT_TEXT_SCALE;
}

/**
 * What WE apply, given the user's pick and what the OS is already applying.
 *
 * `getFontScale()` is the OS setting and RN has already applied it to every
 * `<Text>`, so the headroom left for us is the ceiling divided by it. Exported
 * for its test — the clamp is the only part of this file with an edge case.
 */
export function clampTextScale(chosen: number, osScale: number): number {
  return Math.min(chosen, MAX_COMBINED_TEXT_SCALE / (osScale || 1));
}

function resolveTextScale(): number {
  return clampTextScale(chosenTextScale, osFontScale());
}

/**
 * The OS font scale, or 1 where there is no OS to ask.
 *
 * Required lazily rather than imported, for the same reason `prefsDb` requires
 * expo-sqlite lazily: this module is the root of the token graph and is reached
 * by pure unit tests running in plain node, where `react-native`'s Flow source
 * does not parse. There, 1 is the correct answer, not a failure.
 */
function osFontScale(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PixelRatio } =
      require("react-native") as typeof import("react-native");
    return PixelRatio.getFontScale() || 1;
  } catch {
    return 1;
  }
}

/**
 * The multiplier actually applied to every type token below.
 *
 * Exported for the two INSTRUMENTS on the map (the compass tape and the scale
 * bar), whose boxes are fixed geometry sized around their own labels: their
 * type grows with everyone else's, so their label slots and heights have to
 * grow with it or the bearing reads "24…". Layout code should reach for this
 * only where a box is measured in text; everything else is `spacing`.
 */
export const textScale = resolveTextScale();

/**
 * Record the multiplier for the NEXT launch. Returns false when the device
 * refused to store it, so the caller can say so rather than showing a selection
 * that silently reverts.
 */
export function persistTextScale(scale: TextScale): boolean {
  return writePref(TEXT_SCALE_PREF_KEY, String(scale));
}

// Rounded to whole pixels: RN takes fractional font sizes, but a 13.8 px label
// beside a 13.8 px icon lands on a different subpixel on every device.
const scaled = (px: number): number => Math.round(px * textScale);

// Spacing, radius and type read the shared scales (`@logjam/shared`
// designTokens.ts), the same names Logjam Web's tokens are generated from.
//
// SPACING AND RADIUS DO NOT SCALE. Only type does: growing the padding with it
// would push a row's content off the right edge instead of making its words
// bigger, and the icon tiles are sized against `spacing`, not against text.
export const radius = RADIUS;
export const fontSize = {
  xs: scaled(FONT.gps.xs),
  sm: scaled(FONT.gps.sm),
  base: scaled(FONT.gps.base),
  lg: scaled(FONT.gps.lg),
  xl: scaled(FONT.gps.xl),
  /** Hero metric — one per screen, never body copy. */
  display: scaled(FONT.gps.display),
} as const;
/** n steps of the shared unit: `spacing(1.5)` is the web's `--space-1-5`. */
export const spacing = (n: SpaceStep): number => n * SPACE_UNIT;

/** A form's label, field and section gaps (`FORM_RHYTHM` in `@logjam/shared`). */
export const formRhythm = FORM_RHYTHM;

/** A disabled control's dim, the same number on both clients. */
export const opacity = OPACITY;

/** Control heights: a phone is a touch screen, so it takes the touch set. */
export const controlSize = CONTROL.touch;
/** Every pressable's hit area, visual size plus `hitSlop`. */
export const touchTargetMin = TOUCH_TARGET_MIN;
/** `hitSlop` that takes something drawn at `size` to the 48 dp target. */
export const slopTo = (size: number): number =>
  Math.max(0, (touchTargetMin - size) / 2);

// Weight + line-height scales so type roles are consistent across screens
// (page title = xl/bold, body = base/regular at body line-height). RN wants
// weights as strings.
const weight = <W extends number>(w: W) => String(w) as `${W}`;
export const fontWeight = {
  regular: weight(FONT_WEIGHT.regular),
  medium: weight(FONT_WEIGHT.medium),
  bold: weight(FONT_WEIGHT.bold),
} as const;

/** Line height of a role that sets its lines apart (`leading` in `TEXT_ROLES`). */
const leading = scaled(22);

/** One of the type roles' styles, spread into a text style: `...textRole.title`. */
type TextRoleStyle = {
  fontSize: number;
  fontWeight: (typeof fontWeight)[keyof typeof fontWeight];
  lineHeight?: number;
  textTransform?: "uppercase";
  color?: string;
};
export type TextRoles = { [Name in keyof typeof TEXT_ROLES]: TextRoleStyle };
/** The type roles in one scheme, for a reader outside a component. */
export const textRolesFor = perScheme((theme) => {
  return Object.fromEntries(
    Object.entries(TEXT_ROLES).flatMap(([name, spec]) => {
      if (!("gps" in spec)) return [];
      const role: {
        size: keyof typeof fontSize;
        weight: keyof typeof fontWeight;
        uppercase?: true;
        muted?: true;
        leading?: true;
      } = spec.gps;
      // The one place a size and a weight are written together.
      const style: TextRoleStyle = {
        fontSize: fontSize[role.size],
        fontWeight: fontWeight[role.weight],
        ...(role.leading ? { lineHeight: leading } : {}),
        ...(role.uppercase ? { textTransform: "uppercase" } : {}),
        ...(role.muted ? { color: theme.textMuted } : {}),
      };
      return [[name, style]];
    }),
  ) as TextRoles;
});

// Modal/sheet scrims; the words on one are `ON_SCRIM` (shared/DESIGN.md §7).
export { ON_SCRIM, SCRIM as scrim } from "@logjam/shared";

// Default touch-target padding for small text/icon actions.
export const hitSlop = 8;

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
  if (full.length !== 6)
    throw new Error(`withAlpha expects a hex colour, got "${hex}"`);
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
 * them into each scheme's narrow hue range. A hue is only ever a FILL under
 * the `onFill` ink (a tile, an active chip, a swatch, a map mark), never a
 * glyph on a surface, which is what lets one set of hues serve the light
 * scheme too.
 *
 * `region` reuses the active scheme's accent, so the largest, most common
 * asset class always feels native to the chosen theme.
 *
 * Rule for adding one: mid-light, muted, and drawn from the NSW place
 * palette (rock, scrub, water, heath) — never a saturated web primary.
 */
const assetHues = (theme: ThemeTokens) =>
  ({
    /** Downloaded basemap regions — the scheme's own accent. */
    region: theme.accent,
    /** Overlay, GeoPDF, route, import, track and waypoint: shared with Logjam Web
     *  (`ASSET_HUES` in `@logjam/shared`), with the reason for each hue there. */
    ...ASSET_HUES,
  }) as const;

export type AssetHue = keyof ReturnType<typeof assetHues>;

/**
 * Place status identity for the Places screen — the same hue on a row's icon
 * tile and on its filter chip, exactly as `assetHue` works for saved assets
 * (shared/DESIGN.md §8). Scheme-independent for the same reason: a place you have run
 * is what it is regardless of the user's theme.
 */
const placeHues = (theme: ThemeTokens) =>
  ({
    /** Run at least once — the scheme's own accent, because this is the win. */
    done: theme.accent,
    /** Not yet run, and shared with you — `PLACE_STATUS_HUES` in `@logjam/shared`. */
    ...PLACE_STATUS_HUES,
  }) as const;

/**
 * Inbox identity — BORROWED, not invented (shared/DESIGN.md §8). A notification is
 * always about something that lives somewhere else in the app, so it wears that
 * thing's hue: a topo notification is the same eucalypt as a topo overlay in
 * Saved, a place-share is the same heath as a shared place on the Places
 * screen. Recognising a thing again where it lives is what makes the inbox part
 * of the app rather than a log of unrelated events.
 *
 * Adding a kind means pointing at an existing hue. If the thing it refers to has
 * no hue yet, that is the gap to fill first.
 */
const notificationHues = (
  theme: ThemeTokens,
  assetHue: ReturnType<typeof assetHues>,
  placeHue: ReturnType<typeof placeHues>,
) =>
  ({
    /** A place shared with you — as on the Places rail. */
    share: placeHue.shared,
    /** Friends and requests — the account class takes the scheme accent. */
    people: theme.accent,
    /** LiDAR topo jobs — as in Saved. */
    topo: assetHue.overlay,
    /** Topo exports — the waterhole blue of the vector files they produce. */
    export: assetHue.import,
    /** GeoPDFs — as in Saved. */
    geoPdf: assetHue.geoPdf,
    /** A file a friend sent you — the waterhole blue an accepted copy wears in
     *  Saved's Imports, because that is where accepting it puts it. */
    file: assetHue.import,
    /** Anything that failed or was skipped. The one place a hue means "look". */
    problem: theme.warning,
  }) as const;

/**
 * The three hue sets in one scheme, for a reader outside a component (a meta
 * table built from a `theme` argument). A component calls `useHues()`.
 */
export const huesFor = perScheme((theme) => {
  const assetHue = assetHues(theme);
  const placeHue = placeHues(theme);
  return {
    assetHue,
    placeHue,
    notificationHue: notificationHues(theme, assetHue, placeHue),
  };
});

/** `const { assetHue, placeHue } = useHues();` */
export const useHues = () => huesFor(useTheme());
