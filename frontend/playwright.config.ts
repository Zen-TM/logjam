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
  // An axe walk is not a user interaction, and 30s (Playwright's default) is a
  // UI-latency bound, not an analysis one. The a11y spec runs several full
  // `analyze()` passes per test over the heaviest pages in the app, and with
  // four workers sharing one machine those crossed 30s while every other test
  // finished inside 27s (2026-09-17). Raised rather than retried: a retry would
  // hide a real failure to make a loaded box look green.
  //
  // What that raise papered over, found 2026-09-19: the cost is the LIST, not
  // the machine. axe is per-element, so walking Places charged 7.4s for 311
  // rows of one repeated component against 0.17s for two, with the same result
  // — and the dev account had grown from the 37 places the spec was written
  // against. The cases narrow their list before walking it now (e2e/CLAUDE.md),
  // which took Places from 51.7s to 13.5s. The 60s cap stays as headroom, not
  // as the fix.
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
    ? [
        {
          command: "npm run dev",
          url: "http://localhost:5173",
          reuseExistingServer: true,
          env: { VITE_AUTH_MODE: "fake" },
          timeout: 60_000,
        },
        {
          command: "npm run dev -- --port 5199 --strictPort",
          url: SIGN_IN_URL,
          reuseExistingServer: true,
          env: { VITE_AUTH_MODE: "cognito" },
          timeout: 60_000,
        },
      ]
    : undefined,
});
