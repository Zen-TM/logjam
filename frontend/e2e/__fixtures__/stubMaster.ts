// Answers every /master/* read from made-up archives, so a spec that mounts the
// map never reaches the prod CDN. Without it the dev server's /master proxy has
// nothing to serve in CI, the basemap source never loads and MapLibre never
// writes the map's credits. An archive the fixtures lack is a clean 404.
import type { Page, Route } from "@playwright/test";
import { BASEMAP_CATALOG, NSW_REGION } from "@logjam/shared";
import { statewideArchives } from "./geoPdfTiles";

const PROTOMAPS_ARCHIVE = BASEMAP_CATALOG.find(
  (entry) => entry.id === "protomaps",
)!.urlTemplate;

let archives: Record<string, Buffer> | undefined;
function archiveByPath() {
  if (archives) return archives;
  const a = statewideArchives();
  return (archives = {
    [PROTOMAPS_ARCHIVE]: a.basemap,
    [NSW_REGION.terrain.hillshade.archivePath]: a.heights,
    [NSW_REGION.terrain.slope.archivePath]: a.slope,
    [NSW_REGION.terrain.contours.archivePath]: a.contours,
    [NSW_REGION.terrain.land.archivePath]: a.land,
  });
}

export async function stubMaster(page: Page) {
  await page.route("**/master/**", async (route: Route) => {
    const body =
      archiveByPath()[new URL(route.request().url()).pathname.slice(1)];
    if (!body) return route.fulfill({ status: 404 });
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
