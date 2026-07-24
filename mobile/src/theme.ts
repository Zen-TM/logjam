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
export const radius = { sm: 4, md: 8, lg: 12, xl: 16 } as const;
export const fontSize = { xs: 12, sm: 14, base: 16, lg: 20, xl: 24 } as const;
export const spacing = (n: number): number => n * 8;

// Weight + line-height scales so type roles are consistent across screens
// (page title = xl/bold, body = base/regular at body line-height). RN wants
// weights as strings.
export const fontWeight = { regular: "400", medium: "600", bold: "700" } as const;
export const lineHeight = { body: 22, tight: 18 } as const;

// Modal/sheet scrims — the only intentional black-alpha overlays. Everything
// else derives from the scheme. `light` for bottom sheets, `heavy` for
// full-screen edit/image modals.
export const scrim = { light: "rgba(0,0,0,0.5)", heavy: "rgba(0,0,0,0.6)" } as const;

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
