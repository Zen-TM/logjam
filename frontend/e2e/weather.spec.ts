import { expect, test } from "@playwright/test";

// Weather's archives are pruned as runs age. Stubbed: the manifest is a public
// file, the first run's archives 404 the way a pruned run's would, and the
// next manifest names a run whose archives drop like a lost connection (which
// the map retries) so the bar stays ready.
//
// Mutation that turns it red: drop the `archiveGone` call from
// `handleTopoSourceUnavailable` in App.tsx, and the manifest is asked for once.
// (Map.tsx blacklists the entry as for any Terrain layer; leaving the map's
// entry list when the manifest is dropped clears that, so the new run draws.)
test("a pruned run's archive: the manifest is asked for again and the new run is drawn", async ({
  page,
}) => {
  const hour = 3_600_000;
  const start = Math.ceil(Date.now() / hour) * hour;
  const runs = [
    "runs/20261107T0000Z-20261107T0900Z/",
    "runs/20261107T0600Z-20261107T0900Z/",
  ];
  let manifests = 0;
  await page.route("**/master/weather/v1/latest.json", (route) =>
    route.fulfill({
      json: {
        format: 1,
        model: "ecmwf_ifs",
        run: new Date(start - 9 * hour).toISOString(),
        built: new Date(start - hour).toISOString(),
        anchor: new Date(start).toISOString(),
        path: runs[Math.min(manifests++, 1)],
        bounds: [139, -39.5, 156, -26],
        zoom: 5,
        steps: Array.from({ length: 24 }, (_, i) => ({
          time: new Date(start + i * hour).toISOString(),
          hours: 1,
        })),
        totals: [],
        attribution: "",
      },
    }),
  );
  await page.route("**/master/weather/v1/runs/**", (route) =>
    route.request().url().includes(runs[1])
      ? route.abort()
      : route.fulfill({ status: 404, body: "" }),
  );
  const asked = page.waitForRequest((r) => r.url().includes(runs[1]));
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const layers = page.getByRole("dialog", { name: "Map layers" });
  await layers.getByRole("radio", { name: /^Overlays/ }).click();
  await layers.getByRole("switch", { name: "Show weather" }).click();
  await page.keyboard.press("Escape");
  await asked;
  expect(manifests).toBe(2);
  await expect(page.getByRole("slider")).toBeVisible();
  await expect(page.getByText(/map file is missing/)).toHaveCount(0);
});
