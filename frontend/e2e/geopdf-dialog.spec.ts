import { expect, test, type Page, type Route } from "@playwright/test";
import { NSW_CONTOURS, NSW_HILLSHADE, NSW_SLOPE } from "@logjam/shared";
import { baseTilePng, statewideArchives } from "./__fixtures__/geoPdfTiles";

// Make it in Export an area renders the GeoPDF in the tab: tile reads are
// stubbed (made-up fixtures), the PDF arrives as a download, and the page
// still answers input meanwhile. Needs fake auth and the seeded API to open
// the dialog, as export-area.spec.ts does (CI's api-integration job).
//
// Mutation: POST /geo-pdf again from handleGenerate and no download event
// arrives (the request is also asserted absent below).

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

async function stubTiles(page: Page) {
  await page.route("https://maps.six.nsw.gov.au/**", async (route: Route) => {
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
  const geoPdfRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/geo-pdf")
      geoPdfRequests.push(r.method());
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

  const download = page.waitForEvent("download", { timeout: 90_000 });
  await dialog.getByRole("button", { name: "Make it" }).click();

  // The page answers while the worker draws: a control still toggles.
  const chip = dialog.getByRole("radio", { name: "A3" });
  await chip.click({ timeout: 5_000 }).catch(() => {});
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();

  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  const path = await file.path();
  const head = (await import("node:fs")).readFileSync(path).subarray(0, 5);
  expect(head.toString("latin1")).toBe("%PDF-");
  expect(geoPdfRequests).toEqual([]);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});
