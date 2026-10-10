// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const globals = require("globals");

// Gotchas of Logjam GPS that a selector can hold (mobile/DESIGN.md §4, §1).
const GPS_GOTCHAS = [
  {
    selector: "JSXAttribute[name.name='autoFocus']",
    message:
      "autoFocus runs before the field is attached inside a sheet and is unreliable. Keep a ref and call .focus() in requestAnimationFrame once the sheet has opened (mobile/DESIGN.md §4).",
  },
  {
    selector:
      "CallExpression[callee.object.name='Alert'][callee.property.name='alert'][arguments.2.type='ArrayExpression'][arguments.2.elements.length>3]",
    message:
      "Android drops a fourth Alert button. A list of choices is a BottomSheet; Alert is for a destructive confirm only (mobile/DESIGN.md §4).",
  },
];

// A colour is a role from `theme`, or `withAlpha(token, a)` for a tint
// (mobile/DESIGN.md §1). Colours drawn ON the map belong to the basemap, not
// the scheme, and are `MAP_INK` (shared/DESIGN.md §15).
const COLOUR_LITERALS = [
  {
    selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
    message:
      "A screen names a colour role from theme.ts, never a hex. A colour drawn on the map is MAP_INK (shared/src/designTokens.ts).",
  },
  {
    selector: "Literal[value=/^rgba?\\(/]",
    message:
      "A tint is withAlpha(theme.<role>, a), never an rgba() string (mobile/DESIGN.md §1).",
  },
];

// Files that still draw a literal colour, so the colour rule is not on for
// them yet. The list only shrinks: move each onto a role or `MAP_INK`, then
// delete its line.
const COLOUR_LITERAL_DEBT = [
  "src/imports/importsDb.ts",
  "src/map/MapBackButton.tsx",
  "src/map/MapScreen.tsx",
  "src/map/PickPointScreen.tsx",
  "src/map/PlacePinsLayer.tsx",
  "src/map/PlaceRoutesLayer.tsx",
  "src/map/RouteDraftLayer.tsx",
  "src/map/SelectionFrame.tsx",
  "src/map/mapPreferences.ts",
  "src/map/topoVectorLayers.ts",
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["android/**", "ios/**", ".expo/**", "node_modules/**"],
  },
  {
    // One idea, one icon (DESIGN.md, shared/src/icons.ts): a screen renders
    // `<Icon idea="…" />` from the kit and never names a glyph family. Only the
    // kit's Icon, and the place-type helper that resolves a user-picked key,
    // may reach into the icon fonts.
    files: ["src/**/*.{ts,tsx}", "App.tsx"],
    ignores: ["src/ui/Icon.tsx", "src/places/placeTypeIcon.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@expo/vector-icons", "@expo/vector-icons/*"],
              message:
                "Draw icons with <Icon idea=…> from src/ui — add the idea to shared/src/icons.ts if it is missing.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", ...GPS_GOTCHAS] },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "src/theme.ts",
      "src/ui/**",
      ...COLOUR_LITERAL_DEBT,
    ],
    rules: {
      "no-restricted-syntax": ["error", ...GPS_GOTCHAS, ...COLOUR_LITERALS],
    },
  },
  {
    // Build-time scripts run in node, not in the app: they legitimately use
    // Buffer, process and friends, which the Expo config does not declare.
    files: ["scripts/**/*.mjs", "plugins/**/*.js"],
    languageOptions: { globals: globals.node },
  },
]);
