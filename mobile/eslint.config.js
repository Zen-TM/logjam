// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const globals = require("globals");

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
    // Build-time scripts run in node, not in the app: they legitimately use
    // Buffer, process and friends, which the Expo config does not declare.
    files: ["scripts/**/*.mjs", "plugins/**/*.js"],
    languageOptions: { globals: globals.node },
  },
]);
