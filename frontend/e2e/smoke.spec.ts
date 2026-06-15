import { test, expect } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const isLocal = baseURL.startsWith("http://localhost");

// Local dev runs with VITE_AUTH_MODE=fake (auto-authenticated as alice), so the
// app boots straight into the map. Prod uses real Cognito, so an unauthenticated
// visit lands on the sign-in screen. Keep prod smoke auth-free — no committed
// credentials, no private user data touched (privacy rule).
test("app loads", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  await expect(page).toHaveTitle(/logjam/i);

  if (isLocal) {
    // Fake auth → MapLibre canvas should mount.
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
      timeout: 15_000,
    });
  } else {
    // Prod → sign-in form should render for an unauthenticated visitor.
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  }

  // No CSP violations / uncaught errors on first paint.
  expect(errors.filter((e) => /Refused to|Uncaught/i.test(e))).toEqual([]);
});
