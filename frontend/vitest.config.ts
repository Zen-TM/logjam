import { defineConfig } from "vitest/config";

// Standalone vitest config (not the app vite.config.ts, whose CSP meta plugin
// and build settings are irrelevant to tests). jsdom so the useStoredState
// hook test has a localStorage; pure-logic suites ignore the environment.
// execArgv: Node 26 otherwise installs an undefined localStorage global that
// shadows jsdom's.
//
// TZ: a zone behind UTC, set before the workers start (they inherit it). A
// date-only value is stored as UTC midnight and shows the day before in such a
// zone unless it is formatted with `timeZone: "UTC"` (AGENTS.md); in CI's UTC
// or Sydney's AEST no test would notice a format that forgot. Guard:
// the date attribute in PlaceDetailPanel.grade.render.test.tsx.
process.env.TZ = "Pacific/Pago_Pago";

export default defineConfig({
  test: {
    environment: "jsdom",
    execArgv: ["--no-experimental-webstorage"],
    setupFiles: ["./src/testSetup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
