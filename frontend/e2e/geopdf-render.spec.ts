import { expect, test, type Page, type Route } from "@playwright/test";
import {
  BASEMAP_CATALOG,
  NSW_CONTOURS,
  NSW_HILLSHADE,
  NSW_LAND,
  NSW_SLOPE,
} from "@logjam/shared";
// Deliberate subpath imports: the import parser is kept out of the shared
// barrel so pdf-lib never rides into the web bundle.
import {
  parseGeoPdfGeoref,
  chooseMainViewport,
} from "@logjam/shared/dist/geoPdfImport/parseGeoref.js";
import { buildGeoTransform } from "@logjam/shared/dist/geoPdfImport/transform.js";
import {
  baseTilePng,
  statewideArchives,
  unreadableHeights,
} from "./__fixtures__/geoPdfTiles";

// The in-browser GeoPDF renderer, driven through the dev-only bench page
// (geopdf-bench.html) with every network read stubbed: made-up base tiles and
// PMTiles archives, so it needs no API and no tile server.
//
// Mutations, each turning a test below red (checked by hand when written):
//  - seams, at a DEM tile edge: set DEM_HALO_TILE_ROWS and DEM_READ_MARGIN_PX
//    in terrain.ts both to 0 (each alone is covered by the other, so only
//    the pair is red here; terrain.test.ts is red on the halo alone)
//  - seams: resample the terrain from the wrong source row (render.ts, the
//    `block.r0 * TILE_SIZE` argument to resampleGrid)
//  - refusal: drop the `checkPlan` call in render.ts
//  - pixel check: drop the `opaque(...)` test in render.ts's strip loop
//  - vector labels: draw a label only in the strip holding its anchor
//    (`label.y < top || label.y >= bottom` in drawBasemapLabels)
//  - cancel: have the client wait for the worker instead of terminating it

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.skip(
  !baseURL.startsWith("http://localhost"),
  "needs the local dev server",
);

const archives = statewideArchives();
const PROTOMAPS_ARCHIVE = BASEMAP_CATALOG.find(
  (entry) => entry.id === "protomaps",
)!.urlTemplate;
const ARCHIVE_PATHS: Record<string, Buffer> = {
  [NSW_HILLSHADE.archivePath]: archives.heights,
  [NSW_SLOPE.archivePath]: archives.slope,
  [NSW_CONTOURS.archivePath]: archives.contours,
  [NSW_LAND.archivePath]: archives.land,
  [PROTOMAPS_ARCHIVE]: archives.basemap,
};

type Seen = { tiles: number; archives: number; zooms: Set<number> };

/** Answer every read the renderer makes from the fixtures, counting them. */
async function stubNetwork(
  page: Page,
  opts: { delayMs?: number; unreadableHeights?: boolean } = {},
) {
  const broken = opts.unreadableHeights ? unreadableHeights() : null;
  const seen: Seen = { tiles: 0, archives: 0, zooms: new Set() };
  const delay = () =>
    opts.delayMs ? new Promise((r) => setTimeout(r, opts.delayMs)) : null;
  await page.route("https://maps.six.nsw.gov.au/**", async (route: Route) => {
    seen.tiles++;
    await delay();
    // .../tile/{z}/{y}/{x}
    const [z, y, x] = new URL(route.request().url()).pathname
      .split("/")
      .slice(-3)
      .map(Number) as [number, number, number];
    seen.zooms.add(z);
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: baseTilePng(z, x, y),
    });
  });
  await page.route("**/master/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    const body =
      broken && path === NSW_HILLSHADE.archivePath
        ? broken
        : ARCHIVE_PATHS[path];
    if (!body) return route.fulfill({ status: 404 });
    seen.archives++;
    await delay();
    const m = /bytes=(\d+)-(\d+)/.exec(
      route.request().headers()["range"] ?? "",
    );
    // A version, as CloudFront serves one: the persistent cache files tiles under it.
    const etag = `"fixture-${body.length}"`;
    if (!m) return route.fulfill({ status: 200, headers: { etag }, body });
    const a = Number(m[1]);
    const b = Math.min(Number(m[2]), body.length - 1);
    await route.fulfill({
      status: 206,
      headers: { "content-range": `bytes ${a}-${b}/${body.length}`, etag },
      body: body.subarray(a, b + 1),
    });
  });
  return seen;
}

async function openBench(page: Page) {
  await page.goto("/geopdf-bench.html");
  await page.waitForFunction(() => "geoPdfBench" in window);
}

test.describe("the in-browser GeoPDF renderer", () => {
  test.setTimeout(120_000);

  for (const scenario of ["shade", "contours", "land", "vector"]) {
    // Every strip's rows must equal the same rows of a one-strip render, byte
    // for byte, at every layer: base tiles, terrain resampled from a DEM
    // block, contour lines and labels, the map elements.
    test(`strips seam to one-strip pixels: ${scenario}`, async ({ page }) => {
      await stubNetwork(page);
      await openBench(page);
      const r = await page.evaluate(
        (name) => window.geoPdfBench.seamCheck(name, 700_000),
        scenario,
      );
      expect(r.strips).toBeGreaterThan(3);
      expect(r.oneStrip).toBe(1);
      expect(r).toMatchObject({ ok: true });
    });
  }

  // On the map Land goes in below the base's water (TERRAIN_BASEMAP_ANCHORS).
  // Mutation: in render.ts, draw the base's next band before `drawLandOnce` for
  // the slope case, or move `drawLandOnce` after step 3 for the plain one.
  for (const overlays of [[], ["slope"]] as const) {
    test(`Land lies under a vector base's water, with [${overlays}]`, async ({
      page,
    }) => {
      await stubNetwork(page);
      await openBench(page);
      const r = await page.evaluate(
        (o) => window.geoPdfBench.landOnWater([...o]),
        overlays,
      );
      expect(r.water).toBeGreaterThan(1000);
      expect(r.restChanged).toBeGreaterThan(100);
      expect(r.waterChanged).toBe(0);
    });
  }

  // Strict: the check above lets through a few thousand pixels, as much as a
  // label cut at a strip's edge.
  test("a vector base's labels cross a strip's edge whole", async ({
    page,
  }) => {
    await stubNetwork(page);
    await openBench(page);
    const r = await page.evaluate(() =>
      window.geoPdfBench.seamCheck("vector", 700_000, { overlays: [] }, true),
    );
    expect(r.strips).toBeGreaterThan(3);
    expect(r).toMatchObject({ ok: true });
  });

  // The terrain's helper workers cut a strip into bands. Mutation: pass
  // hillshadePixels a `rowOffset` of 0 in runTerrainBand (terrainJobs.ts, the
  // `job.gridRow0` argument), or read a DEM row fewer in `bandRows`: the
  // pixels differ from a render with no helpers. The pooled run starts two
  // helpers whatever the runner's cores, and must have used them.
  for (const scenario of ["shade", "contours"]) {
    test(`terrain helpers draw the same pixels as none: ${scenario}`, async ({
      page,
    }) => {
      await stubNetwork(page);
      await openBench(page);
      const r = await page.evaluate(
        (name) => window.geoPdfBench.poolCheck(name),
        scenario,
      );
      expect(r).toMatchObject({ ok: true, differing: 0 });
      expect(r.helperBands).toBeGreaterThan(0);
    });
  }

  // A helper that throws is not the render's failure. Mutation: drop
  // `e.preventDefault()` in terrainPool.ts: the error reaches the render
  // worker's scope and the render fails. Or make the `failHelper` hook do
  // nothing: no helper is lost.
  test("a helper that fails hands its band back and the render completes", async ({
    page,
  }) => {
    await stubNetwork(page);
    await openBench(page);
    const r = await page.evaluate(() =>
      window.geoPdfBench.poolCheck("shade", true),
    );
    expect(r).toMatchObject({ ok: true, differing: 0, helpersLost: 1 });
  });

  // A strip whose last rows fall on the last row of a DEM tile: with no halo
  // and no read margin its block ends there and the resample clamps where the
  // whole map's grid does not. Terrain alone, so the tolerance can be strict
  // (nothing but a fault is more than a level out), and every rendered row is
  // compared, the overlap under the next strip too.
  test("a strip ending on a DEM tile edge matches the one-strip render", async ({
    page,
  }) => {
    await stubNetwork(page);
    await openBench(page);
    const r = await page.evaluate(async () => {
      const extent = await window.geoPdfBench.extentAtDemTileEdge(
        "shade",
        700_000,
      );
      return window.geoPdfBench.seamCheck(
        "shade",
        700_000,
        {
          extent,
          placeMarkers: [],
          elements: { compass: false, scaleText: false, scaleBar: false },
        },
        true,
      );
    });
    expect(r.strips).toBeGreaterThan(3);
    expect(r).toMatchObject({ ok: true, over3: 0 });
  });

  test("refuses a map this browser cannot draw before it asks for a tile", async ({
    page,
  }) => {
    const seen = await stubNetwork(page);
    await openBench(page);
    const r = await page.evaluate(() =>
      window.geoPdfBench.run("shade", {
        // Far less than any strip of the map could be.
        debug: {
          limits: { maxCanvasPx: 10_000, maxTotalPx: 20_000, maxWidth: 100 },
        },
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: "too-large" });
    expect(seen).toMatchObject({ tiles: 0, archives: 0 });
  });

  test("a strip that does not read back is a refusal, never a PDF", async ({
    page,
  }) => {
    await stubNetwork(page);
    await openBench(page);
    const r = await page.evaluate(() =>
      window.geoPdfBench.run("shade", {
        debug: { failPixelCheck: true },
        returnPdf: true,
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: "too-large" });
    expect(r.pdfBase64).toBeUndefined();
  });

  test("cancel resolves within a second and the page keeps taking input", async ({
    page,
  }) => {
    // Slow tiles, so the render is mid-fetch when it is cancelled.
    await stubNetwork(page, { delayMs: 3000 });
    await openBench(page);
    await page.evaluate(() => {
      const controller = new AbortController();
      (
        window as unknown as { cancelAt: number; result: Promise<unknown> }
      ).result = window.geoPdfBench.run("shade", { signal: controller.signal });
      setTimeout(() => {
        (window as unknown as { cancelAt: number }).cancelAt =
          performance.now();
        controller.abort();
      }, 500);
    });
    const waited = await page.evaluate(async () => {
      const w = window as unknown as {
        cancelAt: number;
        result: Promise<{ ok: boolean; reason?: string }>;
      };
      const r = await w.result;
      return { ms: performance.now() - w.cancelAt, r };
    });
    expect(waited.r).toMatchObject({ ok: false, reason: "cancelled" });
    expect(waited.ms).toBeLessThan(1000);
    await page.getByRole("button", { name: "Ping" }).click();
    await expect(page.locator("#pings")).toHaveText("1");
  });

  test("cached canvas limits that are too small are probed again before a refusal", async ({
    page,
  }) => {
    await stubNetwork(page);
    await openBench(page);
    const key = "logjam.geoPdf.canvasLimits.v1";
    const r = await page.evaluate(
      async ([key]) => {
        // A cache from a browser that could draw almost nothing.
        localStorage.setItem(
          key!,
          JSON.stringify({
            ua: navigator.userAgent,
            limits: { maxCanvasPx: 10_000, maxTotalPx: 20_000, maxWidth: 100 },
          }),
        );
        const run = await window.geoPdfBench.run("shade");
        return { run, cached: JSON.parse(localStorage.getItem(key!)!) };
      },
      [key],
    );
    expect(r.run.ok).toBe(true);
    // And what it found replaced the stale numbers.
    expect(r.cached.limits.maxCanvasPx).toBeGreaterThan(1_000_000);
  });

  // Mutation: credit a layer for arrived bytes, or skip the all-unreadable
  // check in render.ts: the map then prints without its shading and says so
  // in no way.
  test("a terrain layer whose every tile is unreadable is a failure, not a missing layer", async ({
    page,
  }) => {
    await stubNetwork(page, { unreadableHeights: true });
    await openBench(page);
    const r = await page.evaluate(() =>
      window.geoPdfBench.run("shade", { returnPdf: true }),
    );
    expect(r).toMatchObject({ ok: false, reason: "failed" });
    expect(r.pdfBase64).toBeUndefined();
  });

  // Mutation: draw the base from the map image's zoom in render.ts instead of
  // `rasterBaseTiles`, and the base's labels shrink to half with its tiles' reads
  // up fourfold, with every planning test still green.
  test("a base with fixed-size labels is read shallower than imagery", async ({
    page,
  }) => {
    const seen = await stubNetwork(page);
    await openBench(page);
    expect(
      (await page.evaluate(() => window.geoPdfBench.run("plain"))).ok,
    ).toBe(true);
    expect([...seen.zooms]).toEqual([15]);
    seen.zooms.clear();
    expect(
      (await page.evaluate(() => window.geoPdfBench.run("contours"))).ok,
    ).toBe(true);
    expect([...seen.zooms]).toEqual([16]);
  });

  test("progress never goes back and ends at 1", async ({ page }) => {
    await stubNetwork(page);
    await openBench(page);
    const r = await page.evaluate(() =>
      window.geoPdfBench.run("contours", { debug: { maxStripPx: 700_000 } }),
    );
    expect(r.ok).toBe(true);
    expect(r.progress.length).toBeGreaterThan(2);
    for (let i = 1; i < r.progress.length; i++)
      expect(r.progress[i]!).toBeGreaterThanOrEqual(r.progress[i - 1]!);
    expect(r.progress.at(-1)).toBe(1);
  });

  // The dialog's prefetch plans its reads with the renderer's own planning
  // code. Mutation: plan only the top rows of the map (the `whole` span in
  // plan.ts's `statewideReads`): the render then asks the network for tiles
  // the prefetch did not keep.
  test("a render after a prefetch asks the network for the archive headers only", async ({
    page,
  }) => {
    const seen = await stubNetwork(page);
    await openBench(page);
    await page.evaluate(() => window.geoPdfBench.prefetch("contours"));
    const afterPrefetch = seen.archives;
    // Heights are not in the contours scenario: slope and contours, each opened once.
    expect(afterPrefetch).toBeGreaterThan(3);
    const r = await page.evaluate(() =>
      window.geoPdfBench.run("contours", { debug: { maxStripPx: 700_000 } }),
    );
    expect(r.ok).toBe(true);
    expect(seen.archives - afterPrefetch).toBe(2);
  });

  test("the second render of the same area is warm: only headers cross the network", async ({
    page,
  }) => {
    const seen = await stubNetwork(page);
    await openBench(page);
    const first = await page.evaluate(() => window.geoPdfBench.run("shade"));
    expect(first.ok).toBe(true);
    const cold = seen.archives;
    const second = await page.evaluate(() => window.geoPdfBench.run("shade"));
    expect(second.ok).toBe(true);
    // Heights and slope, one header each.
    expect(seen.archives - cold).toBe(2);
  });

  test("the PDF parses as a GeoPDF with the extent that was asked for", async ({
    page,
  }) => {
    await stubNetwork(page);
    await openBench(page);
    const r = await page.evaluate(() =>
      window.geoPdfBench.run("shade", {
        returnPdf: true,
        debug: { maxStripPx: 700_000 },
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.fileName).toBe("Bench.pdf");
    const parsed = await parseGeoPdfGeoref(
      new Uint8Array(Buffer.from(r.pdfBase64!, "base64")),
    );
    expect(parsed.producer).toBe("Logjam GeoPDF Generator");
    const page0 = parsed.pages[0]!;
    const viewport = page0.viewports[chooseMainViewport(page0)]!;
    expect(viewport.quirks).toEqual([]);
    const bounds = buildGeoTransform(viewport).wgs84Bounds;
    for (const side of ["north", "south", "east", "west"] as const)
      expect(bounds[side]).toBeCloseTo(r.extent[side], 7);
  });
});
