import {
  isTripLogCustomFieldDef,
  type TripLogCustomFieldDef,
} from "./tripLogFields.js";
import { MERGEABLE_FIELDS } from "./mergeCanyon.js";

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
  canyonCustomFields?: import("./tripLogFields.js").TripLogCustomFieldDef[];
  notifications: NotificationPreferences;
  autoDownloadGeoPdfs: boolean;
  importMergePolicy?: import("./mergeCanyon.js").CanyonMergePolicy;
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
 * Validate and normalize an importMergePolicy value. Returns the policy if
 * valid (all known fields present with valid values, unknown keys dropped),
 * or undefined if absent/invalid — in which case the caller should omit the
 * field entirely (the default policy is applied at import time).
 */
export function normalizeImportMergePolicy(
  value: unknown,
): import("./mergeCanyon.js").CanyonMergePolicy | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const field of MERGEABLE_FIELDS) {
    const v = candidate[field];
    if (typeof v !== "string" || !VALID_MERGE_VALUES.has(v)) return undefined;
    result[field] = v;
  }
  return result as unknown as import("./mergeCanyon.js").CanyonMergePolicy;
}

export function normalizeUserUiPreferences(value: unknown): UserUiPreferences {
  if (typeof value === "object" && value !== null) {
    const prefs = value as Record<string, unknown>;
    const themeSchemeId = isThemeSchemeId(prefs.themeSchemeId)
      ? prefs.themeSchemeId
      : DEFAULT_THEME_SCHEME_ID;
    const tripLogCustomFields = normalizeCustomFieldDefs(prefs.tripLogCustomFields);
    const canyonCustomFields = normalizeCustomFieldDefs(prefs.canyonCustomFields);
    const notifications = normalizeNotificationPreferences(prefs.notifications);
    const autoDownloadGeoPdfs =
      typeof prefs.autoDownloadGeoPdfs === "boolean" ? prefs.autoDownloadGeoPdfs : true;
    const importMergePolicy = normalizeImportMergePolicy(prefs.importMergePolicy);
    const result: UserUiPreferences = { themeSchemeId, tripLogCustomFields, canyonCustomFields, notifications, autoDownloadGeoPdfs };
    if (importMergePolicy) result.importMergePolicy = importMergePolicy;
    return result;
  }

  return {
    themeSchemeId: DEFAULT_THEME_SCHEME_ID,
    tripLogCustomFields: [],
    canyonCustomFields: [],
    notifications: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    autoDownloadGeoPdfs: true,
  };
}
