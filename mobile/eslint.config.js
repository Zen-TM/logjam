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
    // Build-time scripts run in node, not in the app: they legitimately use
    // Buffer, process and friends, which the Expo config does not declare.
    files: ["scripts/**/*.mjs", "plugins/**/*.js"],
    languageOptions: { globals: globals.node },
  },
]);
