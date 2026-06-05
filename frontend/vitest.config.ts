import { defineConfig } from "vitest/config";

// Standalone vitest config (not the app vite.config.ts, whose CSP meta plugin
// and build settings are irrelevant to tests). jsdom so the useLocalStorage
// hook test has a localStorage; pure-logic suites ignore the environment.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
