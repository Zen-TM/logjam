import { defineConfig } from "vitest/config";

// Standalone vitest config (not the app vite.config.ts, whose CSP meta plugin
// and build settings are irrelevant to tests). jsdom so the useStoredState
// hook test has a localStorage; pure-logic suites ignore the environment.
// Run through `npm test`: it passes --no-experimental-webstorage, because Node
// 26 otherwise installs an undefined localStorage global that shadows jsdom's.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
