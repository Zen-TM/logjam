// Dev-only harness behind geopdf-bench.html, which only `--mode bench` builds
// (vite.config.ts): renders fixed, made-up extents through the real client
// and worker, and reports the time per phase. `window.geoPdfBench` is what
// Playwright drives; the page's button is for a person.
//
// Time it from a built bundle: in frontend/,
//   npx vite build --mode bench && npx vite preview --mode bench
// The dev server serves each terrain helper's modules unbundled, which about
// doubles the terrain time. Real tiles come through the /master proxy, which
// preview keeps (DEV_MASTER_URL); or stub the network, as
// e2e/geopdf-render.spec.ts does, for a run with none.
import {
  computeTileToMapTransform,
  computeZoom,
  extentFromCentreAndSize,
  geoPdfMaxNativeZoom,
  NSW_HILLSHADE,
  TARGET_DPI,
  getMapDimensions,
  RASTER_TEMPLATE_DEFAULTS,
  type GeoPdfConfig,
} from "@logjam/shared";
import { PMTiles } from "pmtiles";
import { prefetchGeoPdf, runGeoPdfRender } from "./client";
import { planStrips } from "./strips";
import type { RenderDebug, RenderPixels, RenderTimings } from "./types";

// An obviously generic point inside the NSW coverage; no place is named.
const CENTRE = { lat: -30, lon: 150 };

function config(
  over: Partial<GeoPdfConfig> & Pick<GeoPdfConfig, "baseLayer" | "overlays">,
  scale = 25000,
  paper: { paperSize: "A5" | "A3"; orientation: "portrait" | "landscape" } = {
    paperSize: "A5",
    orientation: "portrait",
  },
  centre = CENTRE,
): GeoPdfConfig {
  const base = { ...paper, scale };
  const map = getMapDimensions({
    ...base,
    north: 0,
    south: 0,
    east: 0,
    west: 0,
    coordMode: "latlon",
  });
  return {
    ...base,
    extent: extentFromCentreAndSize(
      centre.lat,
      centre.lon,
      scale * (map.w / 1000),
      scale * (map.h / 1000),
    ),
    elements: {
      title: "Bench",
      compass: true,
      scaleText: true,
      scaleBar: true,
      gridLines: "latlon",
    },
    placeMarkers: [
      { lat: centre.lat, lon: centre.lon, name: "Marker", color: "owned" },
    ],
    ...over,
  };
}

// Which overlays a base can carry: hillshade over every sheet but imagery,
// the statewide contours only over imagery (shared/src/nswContours.ts).
export const SCENARIOS: Record<string, GeoPdfConfig> = {
  shade: config({ baseLayer: "six-base", overlays: ["hillshade", "slope"] }),
  contours: config({
    baseLayer: "six-imagery",
    overlays: ["slope", "contours"],
  }),
  plain: config({ baseLayer: "six-base", overlays: [] }),
  // Several megapixels more than the others, for timings.
  big: config(
    { baseLayer: "six-base", overlays: ["hillshade", "slope"] },
    10000,
  ),
};

/**
 * A3 landscape at 1:25 000 (about 17 MP, the #602 timing target) centred on
 * the middle of the served height archive's coverage: for timing against a
 * dev copy of the statewide archives, so no coordinate is written down here.
 */
async function a3Scenario(scale = 25000): Promise<GeoPdfConfig> {
  const header = await new PMTiles(
    `${location.origin}/${NSW_HILLSHADE.archivePath}`,
  ).getHeader();
  return config(
    { baseLayer: "six-base", overlays: ["hillshade", "slope"] },
    scale,
    { paperSize: "A3", orientation: "landscape" },
    {
      lat: (header.minLat + header.maxLat) / 2,
      lon: (header.minLon + header.maxLon) / 2,
    },
  );
}

export type BenchRun = {
  ok: boolean;
  reason?: string;
  timings?: RenderTimings;
  /** Every progress fraction posted, in order. */
  progress: number[];
  fileName?: string;
  /** The PDF, base64, only when asked for. */
  pdfBase64?: string;
  extent: GeoPdfConfig["extent"];
  /** Wall time from the call to the result. */
  wallMs: number;
};

function inputFor(config: GeoPdfConfig) {
  return {
    config,
    slopeBands: RASTER_TEMPLATE_DEFAULTS.slope.bands,
    areas: [],
    vegetationUrls: [],
    origin: location.origin,
  };
}

/** The dialog's background prefetch for a scenario: resolves when it ends. */
async function prefetch(name: string): Promise<number> {
  const scenario = name === "a3" ? await a3Scenario() : SCENARIOS[name];
  if (!scenario) throw new Error("unknown scenario");
  const start = performance.now();
  await new Promise<void>((done) => {
    prefetchGeoPdf(inputFor(scenario), done);
  });
  return performance.now() - start;
}

async function run(
  name: string,
  opts: {
    debug?: RenderDebug;
    returnPdf?: boolean;
    signal?: AbortSignal;
    /** Fields to change in the scenario's config. */
    config?: Partial<GeoPdfConfig>;
  } = {},
): Promise<BenchRun & { pixels?: RenderPixels }> {
  const scenario = name === "a3" ? await a3Scenario() : SCENARIOS[name];
  if (!scenario) throw new Error("unknown scenario");
  const config = { ...scenario, ...opts.config };
  const progress: number[] = [];
  const start = performance.now();
  const result = await runGeoPdfRender(inputFor(config), {
    onProgress: (p) => progress.push(p.fraction),
    signal: opts.signal,
    debug: opts.debug,
  });
  const out: BenchRun & { pixels?: RenderPixels } = {
    ok: result.ok,
    progress,
    extent: config.extent,
    wallMs: performance.now() - start,
    timings: result.timings,
  };
  if (!result.ok) {
    out.reason = result.reason;
    return out;
  }
  out.fileName = result.fileName;
  if (opts.returnPdf) {
    const bytes = new Uint8Array(await result.pdf.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out.pdfBase64 = btoa(bin);
  }
  if (result.pixels) out.pixels = result.pixels;
  return out;
}

// Anti-aliased stroke edges can land a few levels apart; a missing halo is
// tens of levels over whole rows.
const LOOSE = { maxDelta: 12, overFraction: 0.0005 };
// Terrain and tiles alone differ by one level at most, so any pixel past
// three is a fault, even a single row of them.
const STRICT = { maxDelta: 3, overFraction: 0 };

/**
 * Render with `maxStripPx` and with one strip; are the map pixels the same?
 * Strict compares every rendered row of every strip, the overlap under the
 * next strip included: it is where a block edge shows.
 */
async function seamCheck(
  name: string,
  maxStripPx: number,
  config?: Partial<GeoPdfConfig>,
  strict = false,
) {
  const tolerance = strict ? STRICT : LOOSE;
  const many = await run(name, {
    config,
    debug: { collectPixels: true, maxStripPx },
  });
  const one = await run(name, { config, debug: { collectPixels: true } });
  if (!many.pixels || !one.pixels)
    return {
      ok: false,
      strips: 0,
      oneStrip: 0,
      maxDelta: -1,
      over3: -1,
      samples: [],
    };
  const w = one.pixels.width;
  const whole = new Uint8Array(one.pixels.strips[0]!.data);
  let maxDelta = 0;
  let over3 = 0;
  let differing = 0;
  let compared = 0;
  const samples: { x: number; y: number; many: number[]; one: number[] }[] = [];
  for (const strip of many.pixels.strips) {
    // Strict: every rendered row. Otherwise the owned rows only, as the last
    // row of a canvas draws strokes a little differently and is hidden.
    const rows = strict ? strip.rows : strip.owned;
    const got = new Uint8Array(strip.data, 0, rows * w * 4);
    const want = whole.subarray(strip.y * w * 4, (strip.y + rows) * w * 4);
    compared += got.length;
    for (let i = 0; i < got.length; i++) {
      const delta = Math.abs(got[i]! - want[i]!);
      if (delta === 0) continue;
      differing++;
      maxDelta = Math.max(maxDelta, delta);
      if (delta <= 3) continue;
      over3++;
      const p = i >> 2;
      if (samples.length < 20)
        samples.push({
          x: p % w,
          y: strip.y + Math.floor(p / w),
          many: [...got.subarray(p * 4, p * 4 + 4)],
          one: [...want.subarray(p * 4, p * 4 + 4)],
        });
    }
  }
  return {
    // The browser's own resampling of tiles and anti-aliasing of strokes can
    // differ by a level or two with the device coordinate (float32); our own
    // terrain maths cannot (terrain.test.ts). A real seam is far larger.
    ok:
      maxDelta <= tolerance.maxDelta &&
      over3 <= compared * tolerance.overFraction,
    maxDelta,
    over3,
    differing,
    strips: many.timings!.strips,
    oneStrip: one.timings!.strips,
    samples,
  };
}

/**
 * Render with the terrain helper workers and with none: are the map's pixels
 * the same, byte for byte? Both draw in one strip, so only the pool differs.
 */
async function poolCheck(name: string, failHelper = false) {
  const pooled = await run(name, {
    debug: { collectPixels: true, poolSize: 2, failHelper },
  });
  const alone = await run(name, {
    debug: { collectPixels: true, noPool: true },
  });
  if (!pooled.pixels || !alone.pixels)
    return { ok: false, differing: -1, helperBands: 0, helpersLost: 0 };
  const a = new Uint8Array(pooled.pixels.strips[0]!.data);
  const b = new Uint8Array(alone.pixels.strips[0]!.data);
  let differing = a.length === b.length ? 0 : -1;
  if (differing === 0)
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
  return {
    ok: differing === 0,
    differing,
    bytes: a.length,
    helperBands: pooled.timings!.helperBands,
    helpersLost: pooled.timings!.helpersLost,
  };
}

const DEM_TILE_PX = 256;

/**
 * A copy of the scenario's extent, nudged north-south so that the bottom
 * rendered row of its first strip (`maxStripPx`) falls on the last DEM row of
 * a tile: the one place a DEM block with no halo and no read margin would
 * clamp where the whole map's grid does not. A guard for that is only a guard
 * if a test reaches it, and strips do not line up so by chance.
 */
function extentAtDemTileEdge(
  name: string,
  maxStripPx: number,
): GeoPdfConfig["extent"] {
  const base = SCENARIOS[name]!;
  const geometry = (shift: number) => {
    const e = {
      ...base.extent,
      north: base.extent.north + shift,
      south: base.extent.south + shift,
    };
    const lat = (e.north + e.south) / 2;
    const zoom = computeZoom(
      base.scale,
      lat,
      TARGET_DPI,
      geoPdfMaxNativeZoom(base.baseLayer),
    );
    const p = computeTileToMapTransform(
      zoom,
      e.north,
      e.south,
      e.east,
      e.west,
      1,
      1,
    );
    const w = Math.round(p.srcW);
    const h = Math.round(p.srcH);
    const strips = planStrips(w, h, maxStripPx);
    const dem = Math.min(zoom, 15);
    const t = computeTileToMapTransform(
      dem,
      e.north,
      e.south,
      e.east,
      e.west,
      w,
      h,
    );
    const bottom = strips[0]!.y + strips[0]!.renderHeight;
    const v = (bottom - 0.5) / t.scaleY + t.offsetY - 0.5;
    // How far past the last row of a tile the strip's bottom read falls.
    const phase = ((v % DEM_TILE_PX) + DEM_TILE_PX) % DEM_TILE_PX;
    return { e, off: Math.abs(phase - (DEM_TILE_PX - 0.6)) };
  };
  let best = { shift: 0, off: Infinity };
  // A tile of z15 is about 0.0082 degrees tall: scan it, then refine.
  for (let pass = 0, span = 0.0083, centre = 0.00415; pass < 3; pass++) {
    const step = span / 200;
    for (let i = 0; i <= 200; i++) {
      const shift = centre - span / 2 + i * step;
      const { off } = geometry(shift);
      if (off < best.off) best = { shift, off };
    }
    centre = best.shift;
    span = step * 4;
  }
  return geometry(best.shift).e;
}

declare global {
  interface Window {
    geoPdfBench: {
      run: typeof run;
      prefetch: typeof prefetch;
      seamCheck: typeof seamCheck;
      poolCheck: typeof poolCheck;
      extentAtDemTileEdge: typeof extentAtDemTileEdge;
      scenarios: string[];
    };
  }
}
window.geoPdfBench = {
  run,
  prefetch,
  seamCheck,
  poolCheck,
  extentAtDemTileEdge,
  scenarios: [...Object.keys(SCENARIOS), "a3"],
};

const select = document.getElementById("scenario") as HTMLSelectElement;
for (const name of window.geoPdfBench.scenarios)
  select.add(new Option(name, name));
const out = document.getElementById("out") as HTMLPreElement;
const pings = document.getElementById("pings") as HTMLOutputElement;
document.getElementById("run")!.addEventListener("click", async () => {
  out.textContent = "rendering...";
  const r = await run(select.value);
  out.textContent = JSON.stringify(
    r,
    (_k, v) => (v === r.progress ? undefined : v),
    2,
  );
});
// Something a person can click while a render runs.
document.getElementById("ping")!.addEventListener("click", () => {
  pings.textContent = String(Number(pings.textContent) + 1);
});
