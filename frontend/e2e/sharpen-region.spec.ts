import { expect, test, type Page } from "@playwright/test";
import { MAP_TERRAIN, SHARPEN_OFF_REASON } from "@logjam/shared";
import { stubMaster } from "./__fixtures__/stubMaster";

// Sharpening follows the region the map shows: its portal in the dialog, and
// "Not available here" at every entry point where the region has none. The
// simulated regions are switched on from the page (LOGJAM_SIM_REGIONS, which
// shared reads when it loads), because a prod region list has no region
// without sharpening to look at. Local dev only: it needs the fake-auth
// server, and the switch must never reach a deployed site.
test.skip(
  !(process.env.E2E_BASE_URL ?? "http://localhost:5173").startsWith(
    "http://localhost",
  ),
  "needs the fake-auth dev server",
);

const view = (lat: number, lng: number) =>
  JSON.stringify({ lat, lng, zoom: 11, bearing: 0, pitch: 0 });
const ZION = view(37.285, -112.945);
const MAKARORA = view(-44.055, 169.25);
const SYDNEY = view(-33.87, 151.21);

async function openAt(page: Page, mapView: string, sim: boolean) {
  await stubMaster(page);
  await page.addInitScript(
    ([stored, simulated]) => {
      if (simulated)
        (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS =
          true;
      // The portal opens in a tab; record the address instead of loading it.
      (window as { opened?: string }).opened = undefined;
      window.open = (url) => {
        (window as { opened?: string }).opened = String(url);
        return null;
      };
      if (localStorage.getItem("logjam.mapView") === null)
        localStorage.setItem("logjam.mapView", stored!);
    },
    [mapView, sim] as const,
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled({
    timeout: 30_000,
  });
}

const trayTool = (page: Page) =>
  page
    .getByRole("group", { name: "Tools" })
    .getByRole("button", { name: /^Sharpen an area/ });

async function openTray(page: Page) {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  return trayTool(page);
}

// Mutation: pass `offer={sharpenOfferFor(null, null)}` to TopoDialog in App.tsx, and
// the dialog names ELVIS over Zion.
test("over a region whose portal has no errand, the dialog names it and gives its link", async ({
  page,
}) => {
  await openAt(page, ZION, true);
  const tool = await openTray(page);
  await expect(tool).not.toHaveAttribute("aria-disabled", "true");
  await tool.click();
  const dialog = page.locator("dialog[open]");
  await expect(
    dialog.getByText(
      "Drop your USGS ZIP here, or select it in your file system.",
    ),
  ).toBeVisible();
  await expect(dialog.getByText(/ELVIS/)).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Haven't got one? Get LiDAR from USGS" })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Getting LiDAR from USGS" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Open the USGS portal" }).click();
  expect(
    await page.evaluate(() => (window as { opened?: string }).opened),
  ).toBe("https://apps.nationalmap.gov/lidar-explorer/");
});

// Mutation: leave `unavailable` out of the `sharpen` tool in App.tsx, or
// `sharpenOff` out of the Sharpened areas view in LayersPopover.tsx, and the
// entry point over Makarora opens a dialog with nothing to offer.
test("over a region with no sharpening, the entry points say so and open nothing", async ({
  page,
}) => {
  await openAt(page, MAKARORA, true);
  const tool = await openTray(page);
  await expect(tool).toHaveAttribute("aria-disabled", "true");
  await expect(tool).toContainText(MAP_TERRAIN.copy.notHere);
  // Playwright will not click what aria-disabled marks: the press is the point.
  await tool.click({ force: true });
  await expect(page.getByRole("tooltip")).toHaveText(
    SHARPEN_OFF_REASON["already-fine"],
  );
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Map layers" })
    .getByRole("radio", { name: "Terrain" })
    .click();
  await page.getByRole("button", { name: /^Sharpened areas/ }).click();
  const make = page.getByRole("button", { name: "Sharpen an area" });
  await expect(make).toHaveAttribute("aria-disabled", "true");
  await make.click({ force: true });
  await expect(page.getByRole("tooltip")).toHaveText(
    `${MAP_TERRAIN.copy.notHere}. ${SHARPEN_OFF_REASON["already-fine"]}`,
  );
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

// Mutation: rename NSW's portal in shared/src/regions.ts, and prod's one
// region reads differently.
test("over New South Wales, with no switch, it reads as it always did", async ({
  page,
}) => {
  await openAt(page, SYDNEY, false);
  const tool = await openTray(page);
  await expect(tool).not.toHaveAttribute("aria-disabled", "true");
  await expect(tool).not.toContainText(MAP_TERRAIN.copy.notHere);
  await tool.click();
  const dialog = page.locator("dialog[open]");
  await expect(
    dialog.getByText(
      "Drop your ELVIS ZIP here, or select it in your file system.",
    ),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Haven't got one? Order LiDAR from ELVIS" })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Getting LiDAR from ELVIS" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Open the ELVIS portal" }).click();
  expect(
    await page.evaluate(() => (window as { opened?: string }).opened),
  ).toBe("https://elevation.fsdf.org.au/");
});
