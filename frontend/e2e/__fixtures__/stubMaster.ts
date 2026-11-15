// Answers every /master/* read from made-up archives, so a spec that mounts the
// map never reaches the prod CDN. Without it the dev server's /master proxy has
// nothing to serve in CI, the basemap source never loads and MapLibre never
// writes the map's credits. An archive the fixtures lack is a clean 404.
// The simulated regions' archives are answered too, from the one-tile copies in
// shared/src/__fixtures__/sim-regions/ (scripts/sim-regions/README.md); only a
// build with VITE_SIM_REGIONS=1 asks for those paths. Guard:
// sim-regions-stub.spec.ts.
import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { BASEMAP_CATALOG, NSW_REGION } from "@logjam/shared";
import { statewideArchives } from "./geoPdfTiles";

const PROTOMAPS_ARCHIVE = BASEMAP_CATALOG.find(
  (entry) => entry.id === "protomaps",
)!.urlTemplate;

const SIM_BUILD = new URL(
  "../../../scripts/sim-regions/boxes.json",
  import.meta.url,
);
const SIM_FIXTURES = new URL(
  "../../../shared/src/__fixtures__/sim-regions/",
  import.meta.url,
);
/** Each simulated archive's served path: every `path` in the build's own
 *  declaration that lies under master/ (the point cloud's lies under lidar/). */
export function simArchivePaths(): string[] {
  const { regions } = JSON.parse(readFileSync(SIM_BUILD, "utf8")) as {
    regions: Record<string, Record<string, { path?: unknown } | unknown>>;
  };
  return Object.values(regions).flatMap((region) =>
    Object.values(region).flatMap((entry) => {
      const path = (entry as { path?: unknown } | null)?.path;
      return typeof path === "string" && path.startsWith("master/")
        ? [path]
        : [];
    }),
  );
}

let archives: Record<string, Buffer> | undefined;
function archiveByPath() {
  if (archives) return archives;
  const a = statewideArchives();
  const sim = Object.fromEntries(
    simArchivePaths().map((path) => [
      path,
      readFileSync(new URL(path.split("/").pop()!, SIM_FIXTURES)),
    ]),
  );
  return (archives = {
    ...sim,
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
