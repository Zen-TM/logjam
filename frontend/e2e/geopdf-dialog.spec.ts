import { expect, test, type Page, type Route } from "@playwright/test";
import { NSW_CONTOURS, NSW_HILLSHADE, NSW_SLOPE } from "@logjam/shared";
import { baseTilePng, statewideArchives } from "./__fixtures__/geoPdfTiles";

// Make it in Export an area renders the GeoPDF in the tab: tile reads are
// stubbed (made-up fixtures, slowed so the render outlasts the interaction),
// the PDF arrives as a download, and the page answers input meanwhile. Needs
// fake auth and the seeded API to open the dialog, as export-area.spec.ts
// does (CI's api-integration job).
//
// The seeded user has a sharpened job whose archives sit on MiniStack. The
// area is typed in far from its footprint, and every request to that host is
// stubbed, so the spec never depends on MiniStack's CORS or Range handling.
//
// Mutations: POST /geo-pdf again from handleGenerate (no download, and the
// request is asserted absent); render on the main thread (the chip click
// would wait out the render); drop the progress bar (the visibility check).

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.skip(
  !baseURL.startsWith("http://localhost"),
  "needs the local fake-auth stack",
);
test.use({ viewport: { width: 1440, height: 900 } });

const archives = statewideArchives();
const ARCHIVE_PATHS: Record<string, Buffer> = {
  [NSW_HILLSHADE.archivePath]: archives.heights,
  [NSW_SLOPE.archivePath]: archives.slope,
  [NSW_CONTOURS.archivePath]: archives.contours,
};

/** Every origin a render may reach once Make it is pressed: the stubbed tile
 *  host and MiniStack, and the app's own. Anything else fails the test. */
const ALLOWED_AFTER_MAKE = ["https://maps.six.nsw.gov.au", "http://localhost"];
const TILE_DELAY_MS = 500;

async function stubTiles(page: Page) {
  // The seeded job's presigned archives: not wanted, so a clean 404.
  await page.route("http://localhost:4566/**", (route) =>
    route.fulfill({
      status: 404,
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.route("https://maps.six.nsw.gov.au/**", async (route: Route) => {
    await new Promise((r) => setTimeout(r, TILE_DELAY_MS));
    const [z, y, x] = new URL(route.request().url()).pathname
      .split("/")
      .slice(-3)
      .map(Number) as [number, number, number];
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: baseTilePng(z, x, y),
    });
  });
  await page.route("**/master/**", async (route: Route) => {
    const body =
      ARCHIVE_PATHS[new URL(route.request().url()).pathname.slice(1)];
    if (!body) return route.fallback();
    const m = /bytes=(\d+)-(\d+)/.exec(
      route.request().headers()["range"] ?? "",
    );
    if (!m) return route.fulfill({ status: 200, body });
    const a = Number(m[1]);
    const b = Math.min(Number(m[2]), body.length - 1);
    await route.fulfill({
      status: 206,
      headers: { "content-range": `bytes ${a}-${b}/${body.length}` },
      body: body.subarray(a, b + 1),
    });
  });
}

test("Make it downloads a PDF made in the tab, and the page stays live", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await stubTiles(page);
  const after: string[] = [];
  let made = false;
  page.on("request", (r) => {
    if (made) after.push(new URL(r.url()).origin);
  });
  // The print's extent, title and markers would reach the API only in a
  // POST; the GeoPDFs panel's list (a GET) still loads until it is removed.
  const geoPdfPosts: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname.startsWith("/geo-pdf")
    )
      geoPdfPosts.push(r.url());
  });

  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("group", { name: "Tools" })
    .getByText("Make a map")
    .click();
  await page.getByRole("menuitem", { name: "Export an area" }).click();
  const dialog = page.locator("dialog[open]");

  // A made-up area in the far west, clear of every seeded footprint.
  await dialog.getByRole("radio", { name: "Type the edges" }).click();
  for (const [name, value] of [
    ["North", "-31.00"],
    ["West", "142.00"],
  ] as const) {
    const field = dialog.getByRole("textbox", { name });
    await field.fill(value);
    await field.blur();
  }

  const download = page.waitForEvent("download", { timeout: 90_000 });
  made = true;
  await dialog.getByRole("button", { name: "Make it" }).click();
  await expect(dialog.getByRole("progressbar")).toBeVisible();

  // The page answers while the worker draws.
  const chip = dialog.getByRole("radio", { name: "Landscape" });
  await chip.click({ timeout: 5_000 });
  await expect(chip).toHaveAttribute("aria-checked", "true");

  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  const path = await file.path();
  const head = (await import("node:fs")).readFileSync(path).subarray(0, 5);
  expect(head.toString("latin1")).toBe("%PDF-");
  expect(geoPdfPosts).toEqual([]);
  for (const origin of after)
    expect(
      ALLOWED_AFTER_MAKE.some((ok) => origin.startsWith(ok)),
      origin,
    ).toBe(true);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});
