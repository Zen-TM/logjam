import { expect, test, type Page } from "@playwright/test";
import { stubMaster } from "./__fixtures__/stubMaster";

// Make a map offers the base layers of the ground the map is over (ADR 0049):
// the SIX maps over New South Wales only. The simulated regions are switched
// on from the page (LOGJAM_SIM_REGIONS, which shared reads when it loads),
// because a prod region list has no second region to look at. Local dev only:
// it needs the fake-auth server, and the switch must never reach a deployed site.
test.skip(
  !(process.env.E2E_BASE_URL ?? "http://localhost:5173").startsWith(
    "http://localhost",
  ),
  "needs the fake-auth dev server",
);
test.use({ viewport: { width: 1440, height: 900 } });

const view = (lat: number, lng: number) =>
  JSON.stringify({ lat, lng, zoom: 11, bearing: 0, pitch: 0 });
const MAKARORA = view(-44.055, 169.25);
const SYDNEY = view(-33.87, 151.21);

async function openMakeAMapAt(page: Page, mapView: string) {
  await stubMaster(page);
  await page.addInitScript((stored) => {
    (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS = true;
    if (localStorage.getItem("logjam.mapView") === null)
      localStorage.setItem("logjam.mapView", stored);
  }, mapView);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("group", { name: "Tools" })
    .getByText("Make a map")
    .click();
  return page.locator("dialog[open]");
}

// Mutation: list `PRINTABLE_BASE_LAYERS` in GeoPdfDialog.tsx whatever the
// ground (`printableBaseLayersFor`), and the dialog over New Zealand lists the
// SIX maps.
test("over simulated New Zealand the base layers are the ones that print there", async ({
  page,
}) => {
  const dialog = await openMakeAMapAt(page, MAKARORA);
  const layers = dialog.getByRole("radiogroup", { name: "Base layer" });
  await expect(layers.getByRole("radio", { name: "OSM Topo" })).toBeVisible();
  await expect(layers.getByRole("radio", { name: /^SIX Maps/ })).toHaveCount(0);
});

test("over New South Wales it lists the SIX maps as before", async ({
  page,
}) => {
  const dialog = await openMakeAMapAt(page, SYDNEY);
  const layers = dialog.getByRole("radiogroup", { name: "Base layer" });
  await expect(layers.getByRole("radio", { name: /^SIX Maps/ })).toHaveCount(3);
});
