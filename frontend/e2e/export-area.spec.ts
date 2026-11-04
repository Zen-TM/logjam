import { test, expect, type Page } from "@playwright/test";

// Export an area hides itself while a GIS format's box is drawn on the map,
// and expects that box back. App holds the opening's own state (which format
// it starts on, the box it was opened over), and this is the only test of
// that wiring: App has no render harness (it pulls in maplibre).

// Local only: it needs fake auth and a seeded API, as a11y.spec.ts does.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.skip(
  !baseURL.startsWith("http://localhost"),
  "needs the local fake-auth stack",
);

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
}

/** Map tools → Export an area → GeoTIFF → Pick on the map: the
 *  dialog hides and the box tool waits for the export's box. */
async function startGisPick(page: Page) {
  await mapTool(page, ["Make a map", "Export an area"]);
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("radio", { name: "GeoTIFF" }).click();
  await dialog.getByRole("button", { name: "Pick on the map" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}

async function mapTool(page: Page, path: (string | RegExp)[]) {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  const [first, ...rest] = path;
  await page.getByRole("group", { name: "Tools" }).getByText(first).click();
  for (const item of rest)
    await page.getByRole("menuitem", { name: item }).click();
}

test.use({ viewport: { width: 1440, height: 900 } });

test("the pages hold still while an export's box is drawn", async ({
  page,
}) => {
  await openApp(page);
  await startGisPick(page);
  // Mutation: drop `boxPickDimsUI` from App's `dimUI`, and the rail takes the
  // click. Visible first, so a missing button can't pass as an inert one.
  const places = page.getByRole("button", { name: "Places", exact: true });
  await expect(places).toBeVisible();
  await expect(places.click({ trial: true, timeout: 2_000 })).rejects.toThrow();
});

test("a GIS pick holds Tools off and returns to its own form", async ({
  page,
}) => {
  await openApp(page);
  await startGisPick(page);
  // Mutation: drop `disabled={selectingArea}` from MapChrome's Tools button,
  // and a second product can take the box tool over this pick.
  await expect(
    page.getByRole("button", { name: "Tools", exact: true }),
  ).toBeDisabled();
  // Cancel hands the pick back to the dialog that left for it, as it was.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.locator("dialog[open]").getByRole("radio", { name: "GeoTIFF" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("Make a map → Sharpen an area opens its dialog", async ({ page }) => {
  await openApp(page);
  await mapTool(page, ["Make a map", "Sharpen an area"]);
  // Mutation: arm the box pick in App's make-map "topo" entry again, and the
  // dialog never opens: the map waits for a drawn box instead.
  const dialog = page.locator("dialog[open]");
  await expect(
    dialog.getByRole("heading", { name: "Sharpen an area" }),
  ).toBeVisible();
});
