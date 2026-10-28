// Dev-only harness behind geopdf-bench.html (not a Vite build input): renders
// fixed, made-up extents through the real client and worker, and reports the
// time per phase. `window.geoPdfBench` is what Playwright drives; the page's
// button is for a person. Point it at the dev proxy for real tiles, or stub
// the network (e2e/geopdf-render.spec.ts) for a run with none.
import {
  extentFromCentreAndSize,
  getMapDimensions,
  RASTER_TEMPLATE_DEFAULTS,
  type GeoPdfConfig,
} from "@logjam/shared";
import { runGeoPdfRender } from "./client";
import type { RenderDebug, RenderTimings } from "./types";

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
): Promise<BenchRun & { pixels?: Uint8Array }> {
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
  const out: BenchRun & { pixels?: Uint8Array } = {
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
  if (result.pixels) out.pixels = new Uint8Array(result.pixels.data);
  return out;
}

// Anti-aliased stroke edges can land a few levels apart; a missing halo is
// tens of levels over whole rows.
const SEAM_MAX_DELTA = 12;
const SEAM_OVER_FRACTION = 0.0005;

/** Render with `maxStripPx` and with one strip; are the map pixels the same? */
async function seamCheck(
  name: string,
  maxStripPx: number,
  config?: Partial<GeoPdfConfig>,
) {
  const many = await run(name, {
    config,
    debug: { collectPixels: true, maxStripPx },
  });
  const one = await run(name, { config, debug: { collectPixels: true } });
  if (!many.pixels || !one.pixels)
    return { ok: false, strips: 0, firstDiff: -1, differing: 0 };
  let firstDiff = -1;
  let differing = 0;
  let maxDelta = 0;
  let over3 = 0;
  const [w] = one.timings!.mapPx;
  // A few differing pixels, to see what kind of fault it is.
  const samples: { x: number; y: number; many: number[]; one: number[] }[] = [];
  for (let i = 0; i < one.pixels.length; i++) {
    if (many.pixels[i] !== one.pixels[i]) {
      if (firstDiff < 0) firstDiff = i;
      differing++;
      const delta = Math.abs(many.pixels[i]! - one.pixels[i]!);
      maxDelta = Math.max(maxDelta, delta);
      if (delta > 3) over3++;
      const p = i >> 2;
      if (samples.length < 60 && Math.abs(many.pixels[i]! - one.pixels[i]!) > 3)
        samples.push({
          x: p % w,
          y: Math.floor(p / w),
          many: [...many.pixels.subarray(p * 4, p * 4 + 4)],
          one: [...one.pixels.subarray(p * 4, p * 4 + 4)],
        });
    }
  }
  return {
    // The browser's own resampling of tiles and anti-aliasing of strokes can
    // differ by a level or two with the device coordinate (float32); our own
    // terrain maths cannot (terrain.test.ts). A real seam is far larger.
    ok:
      maxDelta <= SEAM_MAX_DELTA &&
      over3 <= one.pixels.length * SEAM_OVER_FRACTION &&
      many.pixels.length === one.pixels.length,
    maxDelta,
    over3,
    strips: many.timings!.strips,
    oneStrip: one.timings!.strips,
    firstDiff,
    differing,
    // Row of the first difference, to see if it sits on a strip seam.
    firstDiffRow: firstDiff < 0 ? -1 : Math.floor(firstDiff / 4 / w),
    samples,
  };
}

declare global {
  interface Window {
    geoPdfBench: {
      run: typeof run;
      seamCheck: typeof seamCheck;
      scenarios: string[];
    };
  }
}
window.geoPdfBench = { run, seamCheck, scenarios: Object.keys(SCENARIOS) };

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
