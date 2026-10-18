import { defineConfig } from "vitest/config";

// Standalone vitest config (not the app vite.config.ts, whose CSP meta plugin
// and build settings are irrelevant to tests). jsdom so the useStoredState
// hook test has a localStorage; pure-logic suites ignore the environment.
// execArgv: Node 26 otherwise installs an undefined localStorage global that
// shadows jsdom's (43 tests fail without it).
export default defineConfig({
  test: {
    environment: "jsdom",
    execArgv: ["--no-experimental-webstorage"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
