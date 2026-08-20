// Map preferences — the device-scoped switches behind Settings → Map.
//
// ONE module rather than one file per switch (the shape `compassPreference.ts`,
// `snapPreference.ts` and `basemapPreference.ts` each took): those predate the
// settings split and each has a caller outside this screen, where these five are
// read in exactly two places — the Map settings page that writes them and
// `MapScreen` that renders them. Five near-identical 20-line files would be five
// copies of the same read/validate/write.
//
// DEVICE-scoped, all of them, and deliberately: which side your thumb reaches
// from, whether this handset's screen may stay lit, and what its long press does
// are claims about a phone, not about a person. None of them syncs, so all of
// them work as a guest and with no signal (DESIGN.md §10).
//
// Every read is SYNCHRONOUS (`prefsDb`), because `MapScreen` renders its chrome
// on the first frame and a layout that settles into the correct side a moment
// later is worse than one that was never wrong.
//
// PRIVACY: a side, a colour, an enum. Nothing about where the user is.
import { readPref, writePref } from "../prefsDb";

/** Which edge carries the action column. The instruments take the other one. */
export type MapControlSide = "right" | "left";

/**
 * What a press-and-hold on the map does. `ask` is the default and the original
 * behaviour: the sheet that offers the two things that can go at a point. The
 * rest skip the sheet for people who always pick the same one.
 */
export type LongPressAction =
  | "ask"
  | "waypoint"
  | "navigate"
  | "route"
  | "measure"
  | "canyon";

/** When the screen is held awake. Defaults to `off` — battery is a field resource. */
export type KeepAwakeMode = "off" | "recording" | "map";

/**
 * Which north the COMPASS TAPE counts from. Display only: the map, the location
 * arrow and the navigate-to chip are true north in both settings, because they
 * are drawn against a true-north map and a magnetic one would be a rotated
 * picture. This is for the user reading a bearing off the phone and setting it
 * on a baseplate compass, where true north is the wrong number by ~12.5°.
 */
export type NorthReference = "true" | "magnetic";

const CONTROL_SIDE_KEY = "mapControlSide";
const MARKER_COLOR_KEY = "mapMarkerColor";
const KEEP_AWAKE_KEY = "mapKeepAwake";
const NORTH_UP_KEY = "mapNorthUp";
const LONG_PRESS_KEY = "mapLongPressAction";
const NORTH_REFERENCE_KEY = "mapNorthReference";
const SCALE_BAR_KEY = "mapScaleBar";
const SPEED_ELEVATION_KEY = "mapSpeedElevation";

/**
 * Read a value constrained to a known set, falling back when the store is empty
 * or holds something this build doesn't recognise (a downgrade, a hand-edited
 * row). Same fallback-don't-throw posture as `theme.ts`: a bad string must not
 * take the map down with it.
 */
function readEnum<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  const stored = readPref(key);
  return valid.includes(stored as T) ? (stored as T) : fallback;
}

const CONTROL_SIDES: readonly MapControlSide[] = ["right", "left"];
const LONG_PRESS_ACTIONS: readonly LongPressAction[] = [
  "ask",
  "waypoint",
  "navigate",
  "route",
  "measure",
  "canyon",
];
const NORTH_REFERENCES: readonly NorthReference[] = ["true", "magnetic"];
const KEEP_AWAKE_MODES: readonly KeepAwakeMode[] = ["off", "recording", "map"];

/**
 * The location marker's colour options.
 *
 * NOT in `theme.ts` with `assetHue`: those encode what a thing IS and are chosen
 * by us, where this is a preference the user sets for legibility against the
 * ground they actually walk on — a blue arrow over blue water is the complaint
 * this exists to answer. Scheme-independent for the same reason the asset hues
 * are: the marker sits on a basemap, not on a scheme surface.
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
  /** Heath flower, as on the Canyons rail. */
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

export function readMapControlSide(): MapControlSide {
  return readEnum(CONTROL_SIDE_KEY, CONTROL_SIDES, "right");
}

/** False when the device refused to store it, so the caller can say so. */
export function writeMapControlSide(side: MapControlSide): boolean {
  return writePref(CONTROL_SIDE_KEY, side);
}

export function readMarkerColorId(): MarkerColorId {
  return readEnum(MARKER_COLOR_KEY, MARKER_COLOR_ORDER, "blue");
}

export function writeMarkerColorId(id: MarkerColorId): boolean {
  return writePref(MARKER_COLOR_KEY, id);
}

export function readKeepAwakeMode(): KeepAwakeMode {
  return readEnum(KEEP_AWAKE_KEY, KEEP_AWAKE_MODES, "off");
}

export function writeKeepAwakeMode(mode: KeepAwakeMode): boolean {
  return writePref(KEEP_AWAKE_KEY, mode);
}

/**
 * True when the map is pinned north-up. Stored as the non-default ("on" means
 * locked) so an absent preference reads as the existing free-rotation behaviour.
 */
export function isNorthUpLocked(): boolean {
  return readPref(NORTH_UP_KEY) === "on";
}

export function writeNorthUpLocked(locked: boolean): boolean {
  return writePref(NORTH_UP_KEY, locked ? "on" : "off");
}

export function readLongPressAction(): LongPressAction {
  return readEnum(LONG_PRESS_KEY, LONG_PRESS_ACTIONS, "ask");
}

export function writeLongPressAction(action: LongPressAction): boolean {
  return writePref(LONG_PRESS_KEY, action);
}

export function readNorthReference(): NorthReference {
  return readEnum(NORTH_REFERENCE_KEY, NORTH_REFERENCES, "true");
}

export function writeNorthReference(reference: NorthReference): boolean {
  return writePref(NORTH_REFERENCE_KEY, reference);
}

/**
 * Whether the scale bar is drawn. On by default; off is for people who know
 * their zoom by eye and want the pixels back. The compass tape drops to the
 * bottom edge when it goes (see MapScreen's instruments stack).
 */
export function isScaleBarEnabled(): boolean {
  return readPref(SCALE_BAR_KEY) !== "off";
}

export function writeScaleBarEnabled(enabled: boolean): boolean {
  return writePref(SCALE_BAR_KEY, enabled ? "on" : "off");
}

/**
 * Whether the speed + elevation chip is drawn above the other instruments.
 *
 * OFF by default, and unlike the scale bar this default is about power rather
 * than pixels: the chip needs a POSITION, so switching it on runs the map's GPS
 * watcher for as long as the map tab is focused and foregrounded, whether or
 * not the user has asked to see themselves. That is the most expensive thing
 * any of these switches can turn on, so it is opt-in and the settings row says
 * what it costs.
 */
export function isSpeedElevationEnabled(): boolean {
  return readPref(SPEED_ELEVATION_KEY) === "on";
}

export function writeSpeedElevationEnabled(enabled: boolean): boolean {
  return writePref(SPEED_ELEVATION_KEY, enabled ? "on" : "off");
}
