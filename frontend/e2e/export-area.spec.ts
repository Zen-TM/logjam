import { test, expect, type Page } from "@playwright/test";

// Export an area hides itself while a GIS format's box is drawn on the map,
// and expects that box back. App holds the opening's own state (which format
// it starts on, the box it was opened over), and this is the only test of
// that wiring: App has no render harness (it pulls in maplibre). Red when an
// abandoned pick leaks into the next opening, which then starts on GeoTIFF.

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

/** Map tools → Export an area → For GIS → GeoTIFF → Pick on the map: the
 *  dialog hides and the box tool waits for the export's box. */
async function abandonGisPick(page: Page) {
  await mapTool(page, ["Make a map", "Export an area"]);
  const dialog = page.locator("dialog[open]");
  await dialog.getByText("For GIS").click();
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
  await abandonGisPick(page);
  // Mutation: drop `boxPickDimsUI` from App's `dimUI`, and the rail takes the
  // click. Visible first, so a missing button can't pass as an inert one.
  const places = page.getByRole("button", { name: "Places", exact: true });
  await expect(places).toBeVisible();
  await expect(places.click({ trial: true, timeout: 2_000 })).rejects.toThrow();
});

test("Map tools after an abandoned GIS pick opens a fresh GeoPDF form", async ({
  page,
}) => {
  await openApp(page);
  await abandonGisPick(page);
  // Mutation: let `freshExportDialog` skip its key bump, and the dialog keeps
  // the GeoTIFF the abandoned opening chose.
  await mapTool(page, ["Make a map", "Export an area"]);
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("radio", { name: "GeoPDF" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(dialog.getByText("For GIS").locator("..")).not.toHaveAttribute(
    "open",
    "",
  );
});

test("Make on the GeoPDFs page after an abandoned GIS pick opens a GeoPDF form", async ({
  page,
}) => {
  await openApp(page);
  await abandonGisPick(page);
  // A topo takes the box tool over, which leaves the rail live again.
  // `LIDAR_JOB_COPY.make`.
  await mapTool(page, ["Make a map", "Sharpen an area"]);
  await page.getByRole("button", { name: "Maps", exact: true }).click();
  const aside = page.locator("aside");
  await aside.getByRole("radio", { name: "GeoPDFs" }).click();
  await aside.getByRole("button", { name: /^Make/ }).first().click();

  // Mutation: let `freshExportDialog` skip its key bump, and the form opens
  // on GeoTIFF with no paper.
  const dialog = page.locator("dialog[open]");
  await expect(
    dialog.getByRole("radiogroup", { name: "Paper size" }),
  ).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Heights" })).toHaveCount(
    0,
  );
});
