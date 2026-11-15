import { expect, test, type Page } from "@playwright/test";
import { GAUGE_LATEST_PATH, MAP_TERRAIN } from "@logjam/shared";
import { stubMaster } from "./__fixtures__/stubMaster";

// With the map over ground no region declares, every layer that draws a
// region's data reads "Not available here" and is off; with the map back over
// New South Wales the choices the user stored return. Local dev only: it
// needs the fake-auth server, and prod's map is the user's own.
test.skip(
  !(process.env.E2E_BASE_URL ?? "http://localhost:5173").startsWith(
    "http://localhost",
  ),
  "needs the fake-auth dev server",
);

const ON = {
  contours: true,
  coverage: true,
  fire: true,
  slope: true,
  land: true,
  hillshade: true,
  vegetation: true,
};
const view = (lat: number, lng: number) =>
  JSON.stringify({ lat, lng, zoom: 9, bearing: 0, pitch: 0 });
const QUEENSTOWN = view(-45.03, 168.66);
const SYDNEY = view(-33.87, 151.21);

const SWITCHES = [
  "Show contours",
  "Show slope",
  "Show hillshade",
  "Show land tenure",
  "Show fire history",
  "Show coverage",
  "Show river gauges",
];

async function openLayers(page: Page, tab: "Terrain" | "Overlays") {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const popover = page.getByRole("dialog", { name: "Map layers" });
  await popover.getByRole("radio", { name: tab }).click();
  return popover;
}

// Mutation: set `gaugesHere` in App.tsx to true, and the Overlays tab over
// Queenstown offers river gauges (three reasons, not four); or pass the map
// `showGauges` alone, and it reads the gauge feed over Queenstown.
test("a layer with no data here says so, and the choices return over NSW", async ({
  page,
}) => {
  await stubMaster(page);
  // Seeds only what the browser lacks, so a reload keeps the view the app
  // last wrote.
  await page.addInitScript(
    ([mapView, layers]) => {
      if (localStorage.getItem("logjam.mapView") === null) {
        localStorage.setItem("logjam.mapView", mapView!);
        localStorage.setItem("logjam.terrainLayers", layers!);
        localStorage.setItem("logjam.coverageCarrier", '"telstra"');
        localStorage.setItem("logjam.showGauges", "true");
      }
    },
    [QUEENSTOWN, JSON.stringify(ON)],
  );
  // The map reads the gauge feed only where a region has one.
  const gaugeReads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(GAUGE_LATEST_PATH))
      gaugeReads.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled({
    timeout: 30_000,
  });
  expect(gaugeReads).toEqual([]);

  const away = await openLayers(page, "Terrain");
  await expect(away.getByText(MAP_TERRAIN.copy.notHere)).toHaveCount(3);
  for (const name of SWITCHES.slice(0, 3)) {
    const row = away.getByRole("switch", { name });
    await expect(row).toBeDisabled();
    await expect(row).toHaveAttribute("aria-checked", "false");
  }
  await away.getByRole("radio", { name: "Overlays" }).click();
  await expect(away.getByText(MAP_TERRAIN.copy.notHere)).toHaveCount(4);
  for (const name of SWITCHES.slice(3)) {
    const row = away.getByRole("switch", { name });
    await expect(row).toBeDisabled();
    await expect(row).toHaveAttribute("aria-checked", "false");
  }

  // Back over New South Wales, from the same browser storage.
  await page.evaluate(
    (mapView) => localStorage.setItem("logjam.mapView", mapView),
    SYDNEY,
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect.poll(() => gaugeReads.length).toBeGreaterThan(0);
  const home = await openLayers(page, "Terrain");
  await expect(home.getByText(MAP_TERRAIN.copy.notHere)).toHaveCount(0);
  for (const name of SWITCHES.slice(0, 3))
    await expect(home.getByRole("switch", { name })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  await home.getByRole("radio", { name: "Overlays" }).click();
  await expect(home.getByText(MAP_TERRAIN.copy.notHere)).toHaveCount(0);
  for (const name of SWITCHES.slice(3))
    await expect(home.getByRole("switch", { name })).toHaveAttribute(
      "aria-checked",
      "true",
    );
});
