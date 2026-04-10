export type ThemeSchemeId =
  | "sandstoneClassic"
  | "basaltPool"
  | "scribblyGum"
  | "blueMalleeMist"
  | "topoIronbark";

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

export type UserUiPreferences = {
  themeSchemeId: ThemeSchemeId;
};

export const DEFAULT_THEME_SCHEME_ID: ThemeSchemeId = "sandstoneClassic";

export const THEME_SCHEMES: Record<ThemeSchemeId, ThemeScheme> = {
  sandstoneClassic: {
    id: "sandstoneClassic",
    name: "Sandstone Classic",
    description: "Warm weathered sandstone with iron-rich accents.",
    tokens: {
      primary: "#4E4944",
      secondary: "#8C7A5B",
      accent: "#C79657",
      textPrimary: "#F7F3EC",
      textMuted: "#D8CCB9",
      warning: "#C05A1A",
      bonus1: "#D9CBB8",
      bonus2: "#6B5F4B",
      bonus3: "#9C5A2E",
    },
  },
  basaltPool: {
    id: "basaltPool",
    name: "Basalt Pool",
    description: "Cool plunge-water blues against dark gorge rock.",
    tokens: {
      primary: "#2B3F52",
      secondary: "#9B5E33",
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
      accent: "#6CBF8E",
      textPrimary: "#EAF2EC",
      textMuted: "#B4C8BC",
      warning: "#C44536",
      bonus1: "#A8C4A1",
      bonus2: "#22372B",
      bonus3: "#DCE7DA",
    },
  },
  blueMalleeMist: {
    id: "blueMalleeMist",
    name: "Blue Mallee Mist",
    description: "Blue-range haze with warm sunlit escarpment tones.",
    tokens: {
      primary: "#5A7FA3",
      secondary: "#D49A6E",
      accent: "#2A9EB1",
      textPrimary: "#1F2A33",
      textMuted: "#5D6975",
      warning: "#B23B2B",
      bonus1: "#E7D9BA",
      bonus2: "#3F5D4B",
      bonus3: "#7BA7C2",
    },
  },
  topoIronbark: {
    id: "topoIronbark",
    name: "Topo Ironbark",
    description: "Topographic ink tones with native vegetation highlights.",
    tokens: {
      primary: "#2B3A3F",
      secondary: "#4F6F66",
      accent: "#E0BE62",
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
  "sandstoneClassic",
  "basaltPool",
  "scribblyGum",
  "blueMalleeMist",
  "topoIronbark",
];

export function isThemeSchemeId(value: unknown): value is ThemeSchemeId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(THEME_SCHEMES, value)
  );
}

export function normalizeUserUiPreferences(value: unknown): UserUiPreferences {
  if (typeof value === "object" && value !== null) {
    const candidate = (value as { themeSchemeId?: unknown }).themeSchemeId;
    if (isThemeSchemeId(candidate)) {
      return { themeSchemeId: candidate };
    }
  }

  return { themeSchemeId: DEFAULT_THEME_SCHEME_ID };
}
