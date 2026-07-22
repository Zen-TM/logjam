// Design tokens — sourced from the shared theme schemes (single source of
// truth for both clients; MOBILE_DESIGN_BRIEF §4). Stage 1 ships the default
// Sandstone scheme; per-user scheme selection (uiPreferences.themeSchemeId)
// arrives with the settings surface.
import {
  DEFAULT_THEME_SCHEME_ID,
  THEME_SCHEMES,
  type ThemeTokens,
} from "@logjam/shared";

export const theme: ThemeTokens = THEME_SCHEMES[DEFAULT_THEME_SCHEME_ID].tokens;

// Spacing/radius/type scale mirroring the web tokens (frontend/src/index.css).
export const radius = { sm: 4, md: 8, lg: 12 } as const;
export const fontSize = { xs: 12, sm: 14, base: 16, lg: 20, xl: 24 } as const;
export const spacing = (n: number): number => n * 8;
