import { INK } from "./designTokens.js";
import {
  isTripLogCustomFieldDef,
  type TripLogCustomFieldDef,
} from "./tripLogFields.js";

export type ThemeSchemeId = "sandstone" | "basalt" | "scribblyGum" | "ghostGum";

/**
 * A scheme's colours, named for the ROLE each plays — never its rank — and
 * identical on both clients (Logjam Web reads them as `--color-<kebab-role>`).
 * Every scheme declares every role explicitly, with no colour arithmetic at
 * runtime, so `scripts/wcag-contrast.mjs` measures the values that render.
 *
 * Intent colours (`accent`, `warning`, `success`) are fills, edges and glyphs,
 * never the colour of words; words are `text` or `textMuted`. Anything drawn
 * on a fill is `onFill`.
 */
export type ThemeTokens = {
  /** The page, and every surface laid on it: panels, sheets, popovers, menus. */
  page: string;
  /** A surface you can press: an openable row, a pressable tile. */
  card: string;
  /** A card under a finger or a pointer. */
  cardPressed: string;
  /** A text input's well. */
  field: string;
  /** A decorative hairline: separates, need not be seen to be used. */
  line: string;
  /** An edge that must be SEEN (a field, an outline control): ≥3:1 on page, card and field. */
  lineStrong: string;
  /** Body text and glyphs. */
  text: string;
  /** Secondary text. */
  textMuted: string;
  /** The scheme's one colour: a fill, an edge, a glyph. */
  accent: string;
  /** Something needs the user, or is destructive. */
  warning: string;
  /**
   * An ordinary good state — the counterpart to `warning`, and the only green
   * in the palette that means "fine" rather than "this kind of thing".
   *
   * Deliberately muted in every scheme: it marks the ORDINARY case (a file that
   * is backed up, which is most of them), so it has to be readable at a glance
   * and invisible when scanned past.
   */
  success: string;
  /** The hue of a thing with no kind: an untyped trip, an "Add" tile. */
  neutral: string;
  /** The one inverted surface: a toast, a tooltip. */
  inverse: string;
  /** Text and glyphs on `inverse`. */
  onInverse: string;
  /** Text and glyphs on any fill: the accent, an intent colour, an identity hue. */
  onFill: string;
};

export type ThemeScheme = {
  id: ThemeSchemeId;
  name: string;
  description?: string;
  /** Whether the page is dark or light: decides the platform chrome (status
   *  bar, form controls, scrollbars) and the scheme's contrast floor. */
  mode: "dark" | "light";
  tokens: ThemeTokens;
};

export type NotificationPreferences = {
  topoEmail: boolean;
  exportEmail: boolean;
  geoPdfEmail: boolean;
  friendRequestInApp: boolean;
  shareInApp: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  topoEmail: true,
  exportEmail: true,
  geoPdfEmail: true,
  friendRequestInApp: true,
  shareInApp: true,
};

export type UserUiPreferences = {
  themeSchemeId: ThemeSchemeId;
  tripLogCustomFields?: import("./tripLogFields.js").TripLogCustomFieldDef[];
  placeCustomFields?: import("./tripLogFields.js").TripLogCustomFieldDef[];
  notifications: NotificationPreferences;
  autoDownloadGeoPdfs: boolean;
  importMergePolicy?: import("./mergePlace.js").PlaceMergePolicy;
  /**
   * Whether saving a copy of a shared place brings that place's place-level
   * media (photos, videos, and attached track files) with it.
   *
   * A REMEMBERED DEFAULT, never a decision taken out of the user's hands: the
   * copy sheet shows a switch — but only when the place actually has media —
   * pre-set from this field, and flipping it writes back here. Same shape as
   * `importMergePolicy`, which is the other remembered per-operation choice and
   * lives in its operation's own dialog rather than behind a first-run modal.
   *
   * TRUE by default, and the direction matters. Not copying is the silent
   * failure: the sharee loses photos they could see, and on the phone the
   * cached blobs go with them (`cascadePlaceDelete`). Copying is the LOUD one —
   * the server refuses with 507 when the quota will not take it, which the user
   * can read and act on.
   *
   * The SERVER reads this as the fallback when `POST /places/:id/copy` carries
   * no `copyMedia`, so a client with no switch of its own (Logjam Web, today)
   * still honours the user's choice instead of quietly doing the other thing.
   */
  copyPlaceMedia: boolean;
};

export function isNotificationPreferences(
  value: unknown,
): value is Partial<NotificationPreferences> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  for (const key of [
    "topoEmail",
    "exportEmail",
    "geoPdfEmail",
    "friendRequestInApp",
    "shareInApp",
  ] as const) {
    if (key in candidate && typeof candidate[key] !== "boolean") return false;
  }
  return true;
}

function normalizeNotificationPreferences(
  value: unknown,
): NotificationPreferences {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
  const prefs = value as Record<string, unknown>;
  return {
    topoEmail:
      typeof prefs.topoEmail === "boolean"
        ? prefs.topoEmail
        : DEFAULT_NOTIFICATION_PREFERENCES.topoEmail,
    exportEmail:
      typeof prefs.exportEmail === "boolean"
        ? prefs.exportEmail
        : DEFAULT_NOTIFICATION_PREFERENCES.exportEmail,
    geoPdfEmail:
      typeof prefs.geoPdfEmail === "boolean"
        ? prefs.geoPdfEmail
        : DEFAULT_NOTIFICATION_PREFERENCES.geoPdfEmail,
    friendRequestInApp:
      typeof prefs.friendRequestInApp === "boolean"
        ? prefs.friendRequestInApp
        : DEFAULT_NOTIFICATION_PREFERENCES.friendRequestInApp,
    shareInApp:
      typeof prefs.shareInApp === "boolean"
        ? prefs.shareInApp
        : DEFAULT_NOTIFICATION_PREFERENCES.shareInApp,
  };
}

export const DEFAULT_THEME_SCHEME_ID: ThemeSchemeId = "sandstone";

// The three dark schemes keep the values they had under the old rank names:
// `field` is the old web `color-mix(in srgb, black 12%, page)` worked out to a
// hex, `lineStrong` the muted text colour. `cardPressed` is the card a step
// darker in Sandstone and Ironbark, where the old `bonus2` it replaced was
// lighter than the card and muted text failed on it.
export const THEME_SCHEMES: Record<ThemeSchemeId, ThemeScheme> = {
  sandstone: {
    id: "sandstone",
    name: "Sandstone",
    description: "Warm weathered sandstone with iron-rich accents.",
    mode: "dark",
    tokens: {
      page: "#4E4944",
      card: "#61553F",
      cardPressed: "#524836",
      field: "#45403C",
      line: "#6B5F4B",
      lineStrong: "#D8CCB9",
      text: "#F7F3EC",
      textMuted: "#D8CCB9",
      accent: "#DEB188",
      warning: "#F5A693",
      success: "#93B183",
      neutral: "#D9CBB8",
      inverse: "#F7F3EC",
      onInverse: INK,
      onFill: INK,
    },
  },
  basalt: {
    id: "basalt",
    name: "Basalt",
    description: "Cool plunge-water blues against dark gorge rock.",
    mode: "dark",
    tokens: {
      page: "#2B3F52",
      card: "#5F432F",
      cardPressed: "#16232D",
      field: "#263748",
      line: "#16232D",
      lineStrong: "#A7BBC9",
      text: "#EAF1F6",
      textMuted: "#A7BBC9",
      accent: "#4BB4D9",
      warning: "#EB8D99",
      success: "#74C295",
      neutral: "#97AAB8",
      inverse: "#EAF1F6",
      onInverse: INK,
      onFill: INK,
    },
  },
  scribblyGum: {
    id: "scribblyGum",
    name: "Scribbly Gum",
    description:
      "Bushland greys with a hint of green, and fog-softened neutrals.",
    mode: "dark",
    tokens: {
      page: "#2D3E38",
      card: "#3A4D45",
      cardPressed: "#2A3A34",
      field: "#27362F",
      line: "#212E29",
      lineStrong: "#B4C8BC",
      text: "#EAF2EC",
      textMuted: "#B4C8BC",
      accent: "#DAB084",
      warning: "#E6AAA3",
      success: "#8FBE86",
      neutral: "#A8C4A1",
      inverse: "#EAF2EC",
      onInverse: INK,
      onFill: INK,
    },
  },
  // The one light scheme, for reading in full sun: its text pairs clear AAA
  // (7:1), not AA, and only its surfaces and fills are soft. Pale smooth bark
  // and grey-green leaves. Its intent colours sit in the narrow luminance band
  // where they clear 4.5:1 under the dark `onFill` AND 3:1 on the pale page.
  ghostGum: {
    id: "ghostGum",
    name: "Ghost Gum",
    description:
      "Pale smooth bark and grey-green leaves, for reading in full sun.",
    mode: "light",
    tokens: {
      page: "#ECEEE8",
      card: "#F9FAF6",
      cardPressed: "#E0E4DB",
      field: "#F9FAF6",
      line: "#D5DAD0",
      lineStrong: "#7A857C",
      text: "#252A26",
      textMuted: "#4C554D",
      accent: "#6A9072",
      warning: "#C2735A",
      success: "#7E8E3E",
      neutral: "#B3BBAE",
      inverse: "#2B312C",
      onInverse: "#ECEEE8",
      onFill: INK,
    },
  },
};

export const THEME_SCHEME_ORDER: ThemeSchemeId[] = [
  "sandstone",
  "basalt",
  "scribblyGum",
  "ghostGum",
];

export function isThemeSchemeId(value: unknown): value is ThemeSchemeId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(THEME_SCHEMES, value)
  );
}

/**
 * Ids that were schemes once and are not now, with the scheme a stored one
 * becomes. Ironbark shipped (prod accounts may hold it) and its cool grey is
 * Scribbly Gum's now; Daylight was never released, but is mapped anyway so a
 * dev database cannot hold a scheme that does not exist.
 */
export const RETIRED_THEME_SCHEME_IDS: Readonly<Record<string, ThemeSchemeId>> =
  {
    ironbark: "scribblyGum",
    daylight: "ghostGum",
  };

/** A stored or received id as a scheme that exists, or null when it is neither
 *  one nor a retired one. Read every stored `themeSchemeId` through this. */
export function normalizeThemeSchemeId(value: unknown): ThemeSchemeId | null {
  if (isThemeSchemeId(value)) return value;
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(RETIRED_THEME_SCHEME_IDS, value)
    ? RETIRED_THEME_SCHEME_IDS[value]
    : null;
}

// Legacy alias: an early seed/data shape stored free-text fields as type "text",
// which is not a valid TripLogCustomFieldType ("string"). Repair it on read so
// the def passes the strict write-side guard (isTripLogCustomFieldDef) and can
// round-trip through PATCH /users/me without rejecting the whole array.
function repairLegacyFieldType(value: object): object {
  const c = value as Record<string, unknown>;
  if (c.type === "text") return { ...c, type: "string" };
  return value;
}

function normalizeCustomFieldDefs(value: unknown): TripLogCustomFieldDef[] {
  if (!Array.isArray(value)) return [];
  // Repair known legacy shapes, then gate every def through the same strict
  // guard the server enforces — so loaded prefs are always write-valid and a
  // single bad def can never block all custom-field saves. Invalid defs that
  // can't be repaired are dropped (they were unusable anyway).
  return (value as unknown[])
    .map((f) =>
      typeof f === "object" && f !== null ? repairLegacyFieldType(f) : f,
    )
    .filter(isTripLogCustomFieldDef);
}

const VALID_MERGE_VALUES = new Set(["keepExisting", "useIncoming"]);

/**
 * Validate and normalize an importMergePolicy value. Returns the entries that
 * are well-formed, or undefined when the value is absent or not an object.
 *
 * PARTIAL IS NOW VALID, and that is a behaviour change with a reason. The
 * policy used to be a fixed seven-entry union of grade columns, so "all known
 * fields present" was a meaningful check. Its keys are field KEYS now — an
 * open set that differs per user and per place type — so demanding every one
 * of them would reject a perfectly good policy the moment the user added a
 * field, or deleted one, silently reverting all of their merge choices to the
 * default. A missing entry already means `keepExisting` (`mergePolicyFor` in
 * mergePlace.ts), which is the safe direction.
 *
 * Malformed ENTRIES are still dropped rather than tolerated, so a garbage
 * value cannot reach the merge as if it were a decision.
 */
export function normalizeImportMergePolicy(
  value: unknown,
): import("./mergePlace.js").PlaceMergePolicy | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [field, v] of Object.entries(candidate)) {
    if (typeof v === "string" && VALID_MERGE_VALUES.has(v)) result[field] = v;
  }
  return result as unknown as import("./mergePlace.js").PlaceMergePolicy;
}

export function normalizeUserUiPreferences(value: unknown): UserUiPreferences {
  if (typeof value === "object" && value !== null) {
    const prefs = value as Record<string, unknown>;
    const themeSchemeId =
      normalizeThemeSchemeId(prefs.themeSchemeId) ?? DEFAULT_THEME_SCHEME_ID;
    const tripLogCustomFields = normalizeCustomFieldDefs(
      prefs.tripLogCustomFields,
    );
    const placeCustomFields = normalizeCustomFieldDefs(prefs.placeCustomFields);
    const notifications = normalizeNotificationPreferences(prefs.notifications);
    const autoDownloadGeoPdfs =
      typeof prefs.autoDownloadGeoPdfs === "boolean"
        ? prefs.autoDownloadGeoPdfs
        : true;
    const importMergePolicy = normalizeImportMergePolicy(
      prefs.importMergePolicy,
    );
    // Absent reads as TRUE, so every account that predates the field copies
    // media rather than silently dropping it — see the field's own comment.
    const copyPlaceMedia =
      typeof prefs.copyPlaceMedia === "boolean" ? prefs.copyPlaceMedia : true;
    const result: UserUiPreferences = {
      themeSchemeId,
      tripLogCustomFields,
      placeCustomFields,
      notifications,
      autoDownloadGeoPdfs,
      copyPlaceMedia,
    };
    if (importMergePolicy) result.importMergePolicy = importMergePolicy;
    return result;
  }

  return {
    themeSchemeId: DEFAULT_THEME_SCHEME_ID,
    tripLogCustomFields: [],
    placeCustomFields: [],
    notifications: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    autoDownloadGeoPdfs: true,
    copyPlaceMedia: true,
  };
}
