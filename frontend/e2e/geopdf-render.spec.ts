import { expect, test, type Page, type Route } from "@playwright/test";
import { NSW_CONTOURS, NSW_HILLSHADE, NSW_SLOPE } from "@logjam/shared";
// Deliberate subpath imports: the import parser is kept out of the shared
// barrel so pdf-lib never rides into the web bundle.
import {
  parseGeoPdfGeoref,
  chooseMainViewport,
} from "@logjam/shared/dist/geoPdfImport/parseGeoref.js";
import { buildGeoTransform } from "@logjam/shared/dist/geoPdfImport/transform.js";
import { baseTilePng, statewideArchives } from "./__fixtures__/geoPdfTiles";

// The in-browser GeoPDF renderer, driven through the dev-only bench page
// (geopdf-bench.html) with every network read stubbed: made-up base tiles and
// PMTiles archives, so it needs no API and no tile server.
//
// Mutations, each turning a test below red (checked by hand when written):
//  - seams: give planTerrain's blocks no halo (r0/r1 without the +/-1 tile row)
//  - refusal: drop the `checkPlan` call in render.ts
//  - pixel check: drop the `opaque(...)` test in render.ts's strip loop
//  - cancel: have the client wait for the worker instead of terminating it

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.skip(
  !baseURL.startsWith("http://localhost"),
  "needs the local dev server",
);

const archives = statewideArchives();
const ARCHIVE_PATHS: Record<string, Buffer> = {
  [NSW_HILLSHADE.archivePath]: archives.heights,
  [NSW_SLOPE.archivePath]: archives.slope,
  [NSW_CONTOURS.archivePath]: archives.contours,
};

type Seen = { tiles: number; archives: number };

/** Answer every read the renderer makes from the fixtures, counting them. */
async function stubNetwork(page: Page, opts: { delayMs?: number } = {}) {
  const seen: Seen = { tiles: 0, archives: 0 };
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
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: baseTilePng(z, x, y),
    });
  });
  await page.route("**/master/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    const body = ARCHIVE_PATHS[path];
    if (!body) return route.fulfill({ status: 404 });
    seen.archives++;
    await delay();
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
  return seen;
}

async function openBench(page: Page) {
  await page.goto("/geopdf-bench.html");
  await page.waitForFunction(() => "geoPdfBench" in window);
}

test.describe("the in-browser GeoPDF renderer", () => {
  test.setTimeout(120_000);

  for (const scenario of ["shade", "contours"]) {
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
    expect(seen).toEqual({ tiles: 0, archives: 0 });
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
