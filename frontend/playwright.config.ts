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

/**
 * In CI the dev server's /master proxy points at MiniStack. Unset it falls
 * back to the prod CDN, and each run's map tiles count against that
 * distribution's monthly CloudFront request allowance.
 */
const CI_MASTER = process.env.CI
  ? { DEV_MASTER_URL: "http://127.0.0.1:4566/logjam-topo-local" }
  : {};

/**
 * `E2E_PREVIEW=1` serves the builds `npm run build:e2e` makes (`vite preview`)
 * instead of the dev servers. Serving 500-odd modules one by one made every
 * page load seconds long; a build is a handful of files. CI uses it for the
 * suites that need no dev-only page. Locally the dev servers stay the default:
 * they reload on a save, and `geopdf-render.spec.ts` needs the bench page,
 * which only they serve.
 */
const PREVIEW = !!process.env.E2E_PREVIEW;
const serve = (url: string, build: "fake" | "oidc", dev: string) =>
  PREVIEW
    ? `npx vite preview --outDir dist-e2e/${build} --port ${new URL(url).port} --strictPort`
    : dev;

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
  // retry and screenshot on failure.
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
    // An account with no scheme pick follows the OS, so the OS is part of the
    // test: dark opens Sandstone (the whole suite), light opens Ghost Gum (the
    // accessibility audit again, where a pair that only fails on a light page
    // shows up).
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        colorScheme: "dark",
      },
    },
    {
      name: "chromium-light",
      testMatch: /a11y\.spec\.ts/,
      // Cases that cannot differ by scheme (SCHEME_FREE in a11y.spec.ts).
      grepInvert: /@scheme-free/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        colorScheme: "light",
      },
    },
  ],
  // Only auto-boot the frontend when targeting local; for prod we hit the
  // deployed site directly.
  webServer: isLocal
    ? [
        {
          command: serve(
            baseURL,
            "fake",
            `npm run dev -- --port ${new URL(baseURL).port} --strictPort`,
          ),
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          env: { VITE_AUTH_MODE: "fake", ...CI_MASTER },
          timeout: 60_000,
        },
        {
          command: serve(
            SIGN_IN_URL,
            "oidc",
            `npm run dev -- --port ${new URL(SIGN_IN_URL).port} --strictPort`,
          ),
          url: SIGN_IN_URL,
          reuseExistingServer: !process.env.CI,
          // A Cognito-shaped issuer draws Logjam Web's own forms. The pool does
          // not exist: nothing here is submitted. `build:e2e` in package.json
          // bakes the same issuer into the build this server replaces.
          env: {
            VITE_AUTH_MODE: "oidc",
            ...CI_MASTER,
            VITE_OIDC_ISSUER:
              "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_e2e",
          },
          timeout: 60_000,
        },
      ]
    : undefined,
});
