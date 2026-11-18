import { expect, test } from "@playwright/test";
import { stubMaster } from "./__fixtures__/stubMaster";

// Logjam Web started in US English: the words and the day order that differ
// from the Australian source reach the screens that read from the catalogue
// (shared/src/i18nCatalogues/en-US.ts). The reasoning is
// docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md;
// shared/src/usEnglish.test.ts holds the same words and every day form as unit
// tests, and shared/src/i18nCoverage.test.ts that no word is missing an entry.
//
// Local only, like pseudo.spec.ts: it needs fake auth and the seeded API.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.skip(
  !baseURL.startsWith("http://localhost"),
  "needs the local fake-auth stack",
);
// As frontend/src/placeUtils.ts reads it.
const API_URL = process.env.VITE_API_URL ?? "http://localhost:8080";

// The language is fixed at start, read from this key (src/language.ts).
test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: baseURL,
        localStorage: [{ name: "logjam.language", value: "en-US" }],
      },
    ],
  },
});

test.beforeEach(async ({ page }) => {
  // `en-US` is offered only where a simulated region declares it
  // (`offeredHere`, shared), and Logjam Web moves a kept language that is not
  // offered back to the source. This is the switch frontend/src/simRegions.ts
  // sets for a VITE_SIM_REGIONS=1 build, set here so the walk runs on the
  // server every other spec uses.
  await page.addInitScript(() => {
    (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS = true;
  });
  // Running in a language the account has not recorded writes it to the
  // account (`useRecordLanguage`): the seeded account says it has, so this
  // writes nothing (a11y.spec.ts fails a run that writes).
  await page.route(`${API_URL}/users/me`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const user = await response.json();
    await route.fulfill({
      response,
      json: {
        ...user,
        uiPreferences: { ...user.uiPreferences, language: "en-US" },
        // Noon UTC is the same calendar day in every time zone a runner uses.
        monthlyComputeResetAt: "2026-12-01T12:00:00.000Z",
      },
    });
  });
  await stubMaster(page);
});

// Mutation: delete the `"Coloured by steepness"`, `"Land tenure"` or
// `"<day> <month>"` entry from shared/src/i18nCatalogues/en-US.ts (in shared/,
// `npm run build`), or set `en-AU` for the key in `test.use` and for `language`
// in the `/users/me` stub in `beforeEach`.
test("Logjam Web reads in US English: spelling, vocabulary and the day order", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const layers = page.getByRole("dialog", { name: "Map layers" });
  await layers.getByRole("radio", { name: "Terrain" }).click();
  await expect(layers.getByText("Colored by steepness")).toBeVisible();
  await expect(layers.getByText("Coloured by steepness")).toHaveCount(0);
  await layers.getByRole("radio", { name: "Overlays" }).click();
  await expect(layers.getByText("Land ownership")).toBeVisible();
  await page.keyboard.press("Escape");

  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Account" })
    .click();
  // "resets Dec 1", not "resets 1 Dec".
  const aside = page.locator("aside");
  await expect(aside).toContainText("resets Dec 1");
  await expect(aside).not.toContainText("resets 1 Dec");
});
