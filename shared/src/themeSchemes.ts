export type ThemeSchemeId = "sandstone" | "basalt" | "scribblyGum" | "ironbark";

export type ThemeTokens = {
  primary: string;
  secondary: string;
  accent: string;
  textPrimary: string;
  textMuted: string;
  warning: string;
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
  friendRequestInApp: boolean;
  shareInApp: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  topoEmail: true,
  friendRequestInApp: true,
  shareInApp: true,
};

export type UserUiPreferences = {
  themeSchemeId: ThemeSchemeId;
  tripLogCustomFields?: import("./tripLogFields.js").TripLogCustomFieldDef[];
  canyonCustomFields?: import("./tripLogFields.js").TripLogCustomFieldDef[];
  notifications: NotificationPreferences;
  autoDownloadGeoPdfs: boolean;
};

export function isNotificationPreferences(
  value: unknown,
): value is Partial<NotificationPreferences> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  for (const key of ["topoEmail", "friendRequestInApp", "shareInApp"] as const) {
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
      secondary: "#8C7A5B",
      accent: "#B87333",
      textPrimary: "#F7F3EC",
      textMuted: "#D8CCB9",
      warning: "#C05A1A",
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
      secondary: "#886043",
      accent: "#4BB4D9",
      textPrimary: "#EAF1F6",
      textMuted: "#A7BBC9",
      warning: "#D7263D",
      bonus1: "#5E788B",
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
      secondary: "#7B9D88",
      accent: "#D4A470",
      textPrimary: "#EAF2EC",
      textMuted: "#B4C8BC",
      warning: "#C44536",
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
      secondary: "#4F6F66",
      accent: "#B8694F",
      textPrimary: "#ECF2EF",
      textMuted: "#A7B8B2",
      warning: "#E06A4E",
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

function normalizeCustomFieldDefs(
  value: unknown,
): import("./tripLogFields.js").TripLogCustomFieldDef[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(
    (f): f is import("./tripLogFields.js").TripLogCustomFieldDef => {
      if (typeof f !== "object" || f === null) return false;
      const c = f as Record<string, unknown>;
      return (
        typeof c.key === "string" &&
        typeof c.label === "string" &&
        typeof c.type === "string"
      );
    },
  );
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
    return { themeSchemeId, tripLogCustomFields, canyonCustomFields, notifications, autoDownloadGeoPdfs };
  }

  return {
    themeSchemeId: DEFAULT_THEME_SCHEME_ID,
    tripLogCustomFields: [],
    canyonCustomFields: [],
    notifications: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    autoDownloadGeoPdfs: true,
  };
}
