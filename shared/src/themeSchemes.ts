import {
  isTripLogCustomFieldDef,
  type TripLogCustomFieldDef,
} from "./tripLogFields.js";

export type ThemeSchemeId = "sandstone" | "basalt" | "scribblyGum" | "ironbark";

export type ThemeTokens = {
  primary: string;
  secondary: string;
  accent: string;
  textPrimary: string;
  textMuted: string;
  warning: string;
  /**
   * Something is in a good state — the counterpart to `warning`, and the only
   * green in the palette that means "fine" rather than "this kind of thing".
   *
   * Deliberately muted in every scheme: it marks the ORDINARY case (a file that
   * is backed up, which is most of them), so it has to be readable at a glance
   * and invisible when scanned past. A saturated green would pull the eye to
   * every row that is working.
   */
  success: string;
  bonus1: string;
  bonus2: string;
  bonus3: string;
};

export type ThemeScheme = {
  id: ThemeSchemeId;
  name: string;
  description?: string;
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

function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
  const prefs = value as Record<string, unknown>;
  return {
    topoEmail: typeof prefs.topoEmail === "boolean" ? prefs.topoEmail : DEFAULT_NOTIFICATION_PREFERENCES.topoEmail,
    exportEmail:
      typeof prefs.exportEmail === "boolean" ? prefs.exportEmail : DEFAULT_NOTIFICATION_PREFERENCES.exportEmail,
    geoPdfEmail:
      typeof prefs.geoPdfEmail === "boolean" ? prefs.geoPdfEmail : DEFAULT_NOTIFICATION_PREFERENCES.geoPdfEmail,
    friendRequestInApp:
      typeof prefs.friendRequestInApp === "boolean"
        ? prefs.friendRequestInApp
        : DEFAULT_NOTIFICATION_PREFERENCES.friendRequestInApp,
    shareInApp: typeof prefs.shareInApp === "boolean" ? prefs.shareInApp : DEFAULT_NOTIFICATION_PREFERENCES.shareInApp,
  };
}

export const DEFAULT_THEME_SCHEME_ID: ThemeSchemeId = "sandstone";

export const THEME_SCHEMES: Record<ThemeSchemeId, ThemeScheme> = {
  sandstone: {
    id: "sandstone",
    name: "Sandstone",
    description: "Warm weathered sandstone with iron-rich accents.",
    tokens: {
      primary: "#4E4944",
      secondary: "#61553F",
      accent: "#DEB188",
      textPrimary: "#F7F3EC",
      textMuted: "#D8CCB9",
      warning: "#F5A693",
      success: "#93B183",
      bonus1: "#D9CBB8",
      bonus2: "#6B5F4B",
      bonus3: "#9C5A2E",
    },
  },
  basalt: {
    id: "basalt",
    name: "Basalt",
    description: "Cool plunge-water blues against dark gorge rock.",
    tokens: {
      primary: "#2B3F52",
      secondary: "#5F432F",
      accent: "#4BB4D9",
      textPrimary: "#EAF1F6",
      textMuted: "#A7BBC9",
      warning: "#EB8D99",
      success: "#74C295",
      bonus1: "#97AAB8",
      bonus2: "#16232D",
      bonus3: "#E4AA61",
    },
  },
  scribblyGum: {
    id: "scribblyGum",
    name: "Scribbly Gum",
    description: "Bushland greens and fog-softened neutrals.",
    tokens: {
      primary: "#2F4F3E",
      secondary: "#3F5547",
      accent: "#DAB084",
      textPrimary: "#EAF2EC",
      textMuted: "#B4C8BC",
      warning: "#E6AAA3",
      success: "#8FBE86",
      bonus1: "#A8C4A1",
      bonus2: "#22372B",
      bonus3: "#DCE7DA",
    },
  },
  ironbark: {
    id: "ironbark",
    name: "Ironbark",
    description: "Topographic ink tones with native vegetation highlights.",
    tokens: {
      primary: "#2B3A3F",
      secondary: "#364B45",
      accent: "#CD9482",
      textPrimary: "#ECF2EF",
      textMuted: "#A7B8B2",
      warning: "#F18B77",
      success: "#8CB79A",
      bonus1: "#CAD7CF",
      bonus2: "#7FA48F",
      bonus3: "#B9C99D",
    },
  },
};

export const THEME_SCHEME_ORDER: ThemeSchemeId[] = [
  "sandstone",
  "basalt",
  "scribblyGum",
  "ironbark",
];

export function isThemeSchemeId(value: unknown): value is ThemeSchemeId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(THEME_SCHEMES, value)
  );
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
    .map((f) => (typeof f === "object" && f !== null ? repairLegacyFieldType(f) : f))
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
    const themeSchemeId = isThemeSchemeId(prefs.themeSchemeId)
      ? prefs.themeSchemeId
      : DEFAULT_THEME_SCHEME_ID;
    const tripLogCustomFields = normalizeCustomFieldDefs(prefs.tripLogCustomFields);
    const placeCustomFields = normalizeCustomFieldDefs(prefs.placeCustomFields);
    const notifications = normalizeNotificationPreferences(prefs.notifications);
    const autoDownloadGeoPdfs =
      typeof prefs.autoDownloadGeoPdfs === "boolean" ? prefs.autoDownloadGeoPdfs : true;
    const importMergePolicy = normalizeImportMergePolicy(prefs.importMergePolicy);
    // Absent reads as TRUE, so every account that predates the field copies
    // media rather than silently dropping it — see the field's own comment.
    const copyPlaceMedia =
      typeof prefs.copyPlaceMedia === "boolean" ? prefs.copyPlaceMedia : true;
    const result: UserUiPreferences = { themeSchemeId, tripLogCustomFields, placeCustomFields, notifications, autoDownloadGeoPdfs, copyPlaceMedia };
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
