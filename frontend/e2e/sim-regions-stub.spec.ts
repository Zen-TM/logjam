import { expect, test } from "@playwright/test";
import { simArchivePaths, stubMaster } from "./__fixtures__/stubMaster";

// The simulated regions' archives are answered from the committed one-tile
// copies, by range, as the CDN would, so a build with VITE_SIM_REGIONS=1 draws
// them in CI.
test("the master stub serves every simulated archive from its fixture", async ({
  page,
}) => {
  await stubMaster(page);
  await page.goto("/");
  const paths = simArchivePaths();
  // A floor: ten archives are built (scripts/sim-regions/boxes.json).
  expect(paths.length).toBeGreaterThanOrEqual(10);
  // Mutation: have `simArchivePaths` keep only paths under "master/dem/", or
  // drop `...sim` from `archiveByPath` in stubMaster.ts.
  for (const path of paths) {
    const got = await page.evaluate(async (p) => {
      const r = await fetch(`/${p}`, { headers: { Range: "bytes=0-6" } });
      return [r.status, await r.text()];
    }, path);
    expect(got, path).toEqual([206, "PMTiles"]);
  }
  const missing = await page.evaluate(
    async () => (await fetch("/master/dem/nowhere.pmtiles")).status,
  );
  expect(missing).toBe(404);
});
