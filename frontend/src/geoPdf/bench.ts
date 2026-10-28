// Dev-only harness behind geopdf-bench.html (not a Vite build input): renders
// fixed, made-up extents through the real client and worker, and reports the
// time per phase. `window.geoPdfBench` is what Playwright drives; the page's
// button is for a person. Point it at the dev proxy for real tiles, or stub
// the network (e2e/geopdf-render.spec.ts) for a run with none.
import {
  computeTileToMapTransform,
  computeZoom,
  extentFromCentreAndSize,
  geoPdfMaxNativeZoom,
  TARGET_DPI,
  getMapDimensions,
  RASTER_TEMPLATE_DEFAULTS,
  type GeoPdfConfig,
} from "@logjam/shared";
import { runGeoPdfRender } from "./client";
import { planStrips } from "./strips";
import type { RenderDebug, RenderPixels, RenderTimings } from "./types";

// An obviously generic point inside the NSW coverage; no place is named.
const CENTRE = { lat: -30, lon: 150 };

function config(
  over: Partial<GeoPdfConfig> & Pick<GeoPdfConfig, "baseLayer" | "overlays">,
  scale = 25000,
): GeoPdfConfig {
  const base = {
    paperSize: "A5" as const,
    orientation: "portrait" as const,
    scale,
  };
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
      CENTRE.lat,
      CENTRE.lon,
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
      { lat: CENTRE.lat, lon: CENTRE.lon, name: "Marker", color: "owned" },
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
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error("unknown scenario");
  const config = { ...scenario, ...opts.config };
  const progress: number[] = [];
  const start = performance.now();
  const result = await runGeoPdfRender(
    {
      config,
      slopeBands: RASTER_TEMPLATE_DEFAULTS.slope.bands,
      areas: [],
      vegetationUrls: [],
      origin: location.origin,
    },
    {
      onProgress: (p) => progress.push(p.fraction),
      signal: opts.signal,
      debug: opts.debug,
    },
  );
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
      seamCheck: typeof seamCheck;
      extentAtDemTileEdge: typeof extentAtDemTileEdge;
      scenarios: string[];
    };
  }
}
window.geoPdfBench = {
  run,
  seamCheck,
  extentAtDemTileEdge,
  scenarios: Object.keys(SCENARIOS),
};

const select = document.getElementById("scenario") as HTMLSelectElement;
for (const name of Object.keys(SCENARIOS)) select.add(new Option(name, name));
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
