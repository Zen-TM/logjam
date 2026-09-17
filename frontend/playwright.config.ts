import { defineConfig, devices } from "@playwright/test";

// E2E target. Defaults to the local Vite dev server; override for prod:
//   E2E_BASE_URL=https://logjamnsw.com npm run e2e
// Local dev requires the full stack up first: `make dev`, then `cd api && npm run dev`.
// This config auto-starts the *frontend* dev server (fake auth) but NOT api/infra.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const isLocal = baseURL.startsWith("http://localhost");

export default defineConfig({
  testDir: "./e2e",
  // An axe walk is not a user interaction, and 30s (Playwright's default) is a
  // UI-latency bound, not an analysis one. The a11y spec runs several full
  // `analyze()` passes per test over the heaviest pages in the app — Places
  // with 37 places, Logs with hundreds of trips — and with four workers sharing
  // one machine those two crossed 30s while every other test finished inside
  // 27s (2026-09-17). They pass in isolation at ~20s, so the cap was measuring
  // the machine's spare capacity rather than the app. Raised rather than
  // retried: a retry would hide a real failure to make a loaded box look green.
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    // Host (ubuntu 26.04) has no Playwright-bundled chromium build; drive the
    // system Google Chrome via the chrome channel instead.
    channel: "chrome",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  // Only auto-boot the frontend when targeting local; for prod we hit the
  // deployed site directly.
  webServer: isLocal
    ? {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        env: { VITE_AUTH_MODE: "fake" },
        timeout: 60_000,
      }
    : undefined,
});
