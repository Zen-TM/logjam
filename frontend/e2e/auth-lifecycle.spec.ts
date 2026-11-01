import { test, expect } from "@playwright/test";

// Real-provider auth-lifecycle coverage.
//
// All other local testing uses fake auth, so the redirect to the provider's
// sign-in page, the code exchange on the way back and the stored session only
// ever run under jsdom mocks. This spec drives a REAL Cognito-backed deployment
// (Managed Login) through them.
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
// NOT covered here (need external email access / long-running waits):
//   • sign-up → email-code confirm → first login: requires a mailbox API
//     (e.g. Mailosaur) to read the Cognito verification code.
//   • The provider's page is not ours: its field selectors below are the
//     Managed Login defaults and may need adjusting to the pool's branding.
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

    await page.getByLabel("Email").fill(EMAIL!);
    await page.getByLabel("Password").fill(PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // App.tsx blocks behind ConsentGate when needsReconsent() — agree if shown.
    const agree = page.getByRole("button", { name: /Agree and continue/i });
    if (await agree.isVisible({ timeout: 10_000 }).catch(() => false)) {
      // A brand-new account is also asked for a username (prefilled) and its
      // age; the returning user's gate has one checkbox. Check them all.
      const username = page.getByLabel("Username");
      if (await username.isVisible().catch(() => false)) {
        await username.fill(`e2e${Date.now() % 1e9}`);
      }
      for (const box of await page.getByRole("checkbox").all()) {
        await box.check();
      }
      await agree.click();
    }

    // Authenticated → MapLibre canvas mounts.
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
      timeout: 20_000,
    });

    // The session is persisted, and the code is out of the address bar.
    const hasSession = await page.evaluate(() =>
      Object.keys(window.localStorage).some((k) => k.startsWith("oidc.user:")),
    );
    expect(hasSession).toBe(true);
    expect(page.url()).not.toMatch(/[?&]code=/);

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
