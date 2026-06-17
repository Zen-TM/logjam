import { test, expect } from "@playwright/test";

// Real-Cognito auth-lifecycle coverage (gap 4).
//
// All other local testing uses fake auth, so token expiry/refresh, the Amplify
// useAuth state transitions, and the consent pending-key fast path
// (SignIn.tsx → PENDING_CONSENT_STORAGE_KEY → App.tsx → ConsentGate) only ever
// run under jsdom mocks. The 2026-06-11 prod consent incident lived exactly in
// that real-auth + consent seam. This spec drives a REAL Cognito-backed
// deployment.
//
// Gated on env so nothing runs (and no credentials are committed — privacy
// rule) unless an operator points it at a staging pool with a pre-provisioned,
// already-confirmed test account:
//   E2E_AUTH_BASE_URL   a deployment using AUTH_MODE=cognito (staging, NOT prod)
//   E2E_TEST_EMAIL      a confirmed Cognito test user
//   E2E_TEST_PASSWORD   that user's password
//
// Run (skips the local fake webServer by pointing E2E_BASE_URL at staging too):
//   E2E_BASE_URL=$E2E_AUTH_BASE_URL \
//   E2E_AUTH_BASE_URL=https://staging.example \
//   E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... npm run e2e -- auth-lifecycle
//
// NOT covered here (need external email access / long-running waits — operator
// extensions documented alongside this file):
//   • sign-up → email-code confirm → first login: requires a mailbox API
//     (e.g. Mailosaur) to read the Cognito verification code.
//   • full token-expiry → silent-refresh: requires either a short-lived-token
//     staging app client or a long wait; assert on a refreshed token then.

const AUTH_URL = process.env.E2E_AUTH_BASE_URL;
const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;
const ENABLED = Boolean(AUTH_URL && EMAIL && PASSWORD);

test.describe("real Cognito auth lifecycle", () => {
  test.skip(
    !ENABLED,
    "set E2E_AUTH_BASE_URL + E2E_TEST_EMAIL + E2E_TEST_PASSWORD (staging Cognito) to run",
  );

  test("sign in → (consent gate if due) → authenticated map, persisted across reload", async ({
    page,
  }) => {
    await page.goto(AUTH_URL!);

    // Sign-in form (real Cognito → unauthenticated visitor sees it).
    await page.getByLabel("Email").fill(EMAIL!);
    await page.getByLabel("Password").fill(PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // App.tsx blocks behind ConsentGate when needsReconsent() — agree if shown.
    const agree = page.getByRole("button", { name: /Agree & continue/i });
    if (await agree.isVisible({ timeout: 10_000 }).catch(() => false)) {
      // The gate's checkbox must be ticked before the button enables.
      await page.getByRole("checkbox").first().check();
      await agree.click();
    }

    // Authenticated → MapLibre canvas mounts.
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
      timeout: 20_000,
    });

    // A Cognito/Amplify token is persisted (session establishes).
    const hasToken = await page.evaluate(() =>
      Object.keys(window.localStorage).some((k) =>
        /CognitoIdentityServiceProvider|amplify/i.test(k),
      ),
    );
    expect(hasToken).toBe(true);

    // Reload reuses the stored session — no bounce back to sign-in.
    await page.reload();
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toHaveCount(0);
  });
});
