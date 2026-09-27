import { defineConfig, devices } from "@playwright/test";

// E2E target. Defaults to the local Vite dev server; override for prod:
//   E2E_BASE_URL=https://logjamnsw.com npm run e2e
// Local dev requires the full stack up first: `make dev`, then `cd api && npm run dev`.
// This config auto-starts the *frontend* dev server (fake auth) but NOT api/infra.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const isLocal = baseURL.startsWith("http://localhost");

/**
 * A second local dev server, WITHOUT fake auth — the only way to render SignIn.
 * Fake auth (`useAuth`) sets "authenticated" on mount, so the sign-in screen is
 * unreachable on every other target this suite runs against; here it is the
 * default state, one env var away. `VITE_AUTH_MODE` is set explicitly rather
 * than left unset so the branch is this file's decision, not the shell's.
 * No API: every sign-in state is client-side until submit.
 */
const SIGN_IN_URL = process.env.E2E_SIGN_IN_URL ?? "http://localhost:5199";

export default defineConfig({
  testDir: "./e2e",
  // Timeout: An axe walk is not a user interaction, and 30s (Playwright's default) is a
  // UI-latency bound, not an analysis one. The 60s cap stays as headroom for a11y.
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Flake policy: 2 retries in CI, 0 locally. In CI, retries are paired with
  // the github reporter so any test that fails then passes is surfaced as a
  // flake annotation rather than silently passing. Trace is captured on first
  // retry and screenshot on failure. Revisit after 30 days of CI history.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Playwright ships no chromium for some hosts; drive system Chrome via the
    // chrome channel instead.
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
    ? [
        {
          command: "npm run dev",
          url: "http://localhost:5173",
          reuseExistingServer: !process.env.CI,
          env: { VITE_AUTH_MODE: "fake" },
          timeout: 60_000,
        },
        {
          command: "npm run dev -- --port 5199 --strictPort",
          url: SIGN_IN_URL,
          reuseExistingServer: !process.env.CI,
          env: { VITE_AUTH_MODE: "cognito" },
          timeout: 60_000,
        },
      ]
    : undefined,
});
