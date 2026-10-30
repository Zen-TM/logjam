// The GeoPDF renderer, run inside the worker: the server's geometry and
// layer order, drawn strip by strip so no canvas passes this browser's limit.
//
// How a strip stays identical to the same rows of a one-strip render:
//  - every layer draws in whole-map coordinates through an integer translate,
//    and the canvas clips to the strip;
//  - terrain is not stretched by drawImage (a browser's resampling differs
//    with the canvas) but resampled here (`resampleGrid`), each output pixel a
//    pure function of its map coordinates, from a DEM block that reaches one
//    tile row beyond the strip on each side (the halo) so that every
//    neighbour the hillshade and the bilinear read touch is the real one;
//  - contour labels are placed once over the whole map, in tile order;
//  - tiles are drawn in a fixed order.
// Guard: e2e/geopdf-render.spec.ts compares a multi-strip render with a
// one-strip one. It goes red with the terrain resampled from the wrong row, and
// with DEM_HALO_TILE_ROWS and DEM_READ_MARGIN_PX (terrain.ts) both set to 0 (its
// "DEM tile edge" case; each alone is covered by the other, and
// terrain.test.ts goes red on the halo alone).
//
// PRIVACY: nothing here logs. See tiles.ts.
import {
  computeTileToMapTransform,
  GEOPDF_BASE_LAYER_CONFIG,
  GEOPDF_MAX_CANVAS_BYTES,
  GEOPDF_PADDING_MM,
  getPaperDimensions,
  NSW_CONTOURS,
  NSW_HILLSHADE,
  NSW_SLOPE,
  nswContourStyle,
  TILE_SIZE,
  type SharpenedOverlay,
  type TerrainArchiveLayer,
  type TerrainLayerKey,
  type TileCoord,
  type TileToMapTransform,
} from "@logjam/shared";
import type { PMTiles } from "pmtiles";
import { buildGeoPdf, type GeoPdfPageInput } from "./pdf";
import { checkPlan, probeCanvasLimits, type CanvasLimits } from "./probe";
import { canvasRows, planStrips, type Strip } from "./strips";
import {
  areasOnPage,
  contourTilesBySource,
  nswContourZoom,
  overlaysDrawn,
  STATEWIDE,
  terrainCreditLines,
  terrainGrid,
  terrainReadKey,
  type TerrainTileRead,
} from "./terrain";
import type { TileCache } from "./cache";
import { planTerrainBlocks, printGeometry } from "./plan";
import { bandRows } from "./terrainJobs";
import { TerrainPool } from "./terrainPool";
import { openArchive, TileFetcher, type TileBytes } from "./tiles";
import { upperBoundTerrainLines } from "./credits";
import { loadMapFonts } from "./fonts";
import {
  displayZoomForScale,
  mmToPt,
  mmToPx,
  MM_PER_INCH,
  STYLE_DPI,
  type Ctx,
} from "./draw/common";
import {
  attributionLines,
  attributionRows,
  drawAttribution,
  drawCompass,
  drawGridLines,
  drawPlaceMarkers,
  drawScaleBar,
  drawScaleText,
  drawTitle,
  type AttributionInput,
} from "./draw/elements";
import {
  buildContours,
  drawContourLabels,
  drawContourLines,
  type ContourTileInput,
} from "./draw/contours";
import {
  drawMissingTile,
  drawTile,
  reachesRows,
  tileRect,
  type TileRect,
} from "./draw/tiles";
import type {
  GeoPdfProgress,
  GeoPdfRenderInput,
  RenderDebug,
  RenderTimings,
} from "./types";

/** The map cannot be drawn in this browser (or is past the cap): a refusal, not a failure. */
export class TooLarge extends Error {}

export type RenderEnv = {
  signal: AbortSignal;
  /** Cached canvas limits, or null to probe. */
  limits: CanvasLimits | null;
  onLimits: (limits: CanvasLimits) => void;
  onProgress: (progress: GeoPdfProgress) => void;
  debug?: RenderDebug;
  /** The persistent tile cache, where this browser has one. */
  cache?: TileCache | null;
};

export type RenderOutput = {
  pdf: Uint8Array;
  timings: RenderTimings;
  pixels?: {
    width: number;
    height: number;
    /** Each strip's rendered rows (overlap included), RGBA. */
    strips: { y: number; rows: number; owned: number; data: ArrayBuffer }[];
  };
};

const JPEG_QUALITY = 0.95;
const JPEG_TYPE = "image/jpeg";
/** Base tiles decoded at once (each is a 256 KB bitmap). */
const DECODE_BATCH = 8;
/** Bands of a strip's terrain layer per helper. */
const BANDS_PER_HELPER = 2;

// Priority among reads that the same strip needs first.
const RANK = { contours: -1, base: 0, hillshade: 1, slope: 2, vegetation: 3 };
const PER_STRIP = 8;

// Progress: how the 0..1 bar divides. Measured on the bench fixture run and
// by hand on a real one: tiles are most of the wait, drawing most of the rest.
const W_PREPARE = 0.04;
const W_FETCH = 0.36;
const W_DRAW = 0.54;
const W_FINISH = 0.06;

type TileEntry = {
  tile: TileCoord;
  rect: TileRect;
  first: number;
  last: number;
  promise: Promise<TileBytes> | null;
};

/** What decoding a terrain tile came to: not tried, usable, unreadable, or no tile. */
const UNKNOWN = 0;
const OK = 1;
const BAD = 2;
const EMPTY = 3;

type TerrainEntry = {
  read: TerrainTileRead;
  last: number;
  /** Settles when the read has, either way; the bytes are in `bytes`. */
  promise: Promise<void>;
  /** The compressed tile, until it is decoded (then let go). */
  bytes: ArrayBuffer | null;
  status: typeof UNKNOWN | typeof OK | typeof BAD | typeof EMPTY;
  /** The decode, once asked for: every caller waits on the same one. */
  settled: Promise<void> | null;
  decoded: Float32Array | null;
};

/** A strip's terrain layer as painted: RGBA rows from `y` of the strip's canvas. */
type TerrainBands = { y: number; rows: number; rgba: Uint8ClampedArray }[];

type TerrainPlan = {
  key: "hillshade" | "slope";
  smooth: boolean;
  zoom: number;
  t: TileToMapTransform;
  cols: number;
  read: (z: number, x: number, y: number) => TerrainTileRead;
  entries: Map<string, TerrainEntry>;
  /** Per strip: the DEM tile rows it draws from (halo included) and its reads. */
  blocks: { r0: number; r1: number; reads: TerrainTileRead[] }[];
  /** Sources with a tile that decoded: what is credited. */
  credited: Set<string>;
  /** Tiles that arrived, and those of them that decoded. */
  arrived: number;
  decodedOk: number;
};

const aborted = () => new DOMException("aborted", "AbortError");

/**
 * The rows a strip draws, in map pixels: the rows it renders plus, for a
 * strip that does not start the map, a halo above them. A canvas draws its
 * outermost row a little differently from one inside a larger canvas (the
 * browser clips strokes at the edge), and that row of the strip would sit on
 * top of the previous strip's correct overlap in the PDF. The halo is drawn
 * and then cropped off.
 */
const drawnRows = (s: Strip) => {
  const above = canvasRows(s) - s.renderHeight;
  return { from: s.y - above, to: s.y + s.renderHeight, above };
};

export async function renderGeoPdf(
  input: GeoPdfRenderInput,
  env: RenderEnv,
): Promise<RenderOutput> {
  const cleanups: (() => void)[] = [];
  try {
    return await renderInner(input, env, cleanups);
  } finally {
    // On every way out, an abort or a refusal included.
    for (const cleanup of cleanups) cleanup();
  }
}

async function renderInner(
  input: GeoPdfRenderInput,
  env: RenderEnv,
  cleanups: (() => void)[],
): Promise<RenderOutput> {
  const { signal, debug } = env;
  const check = () => {
    if (signal.aborted) throw aborted();
  };
  const t0 = performance.now();
  const config = input.config;
  const timings: RenderTimings = {
    totalMs: 0,
    prepareMs: 0,
    fetchWaitMs: 0,
    drawMs: 0,
    encodeMs: 0,
    pdfMs: 0,
    fetchSpanMs: {},
    requests: {},
    drawBreakdownMs: {},
    strips: 0,
    helperBands: 0,
    mapPx: [0, 0],
  };

  // ── Geometry, as the server ──────────────────────────────────────────────
  const paper = getPaperDimensions({
    paperSize: config.paperSize,
    orientation: config.orientation,
    customRatio: config.customRatio,
    north: 0,
    south: 0,
    east: 0,
    west: 0,
    scale: 0,
    coordMode: "latlon",
  });
  const widthPt = mmToPt(paper.w);
  const heightPt = mmToPt(paper.h);
  const paddingPt = mmToPt(GEOPDF_PADDING_MM);
  const mapWidthMm = paper.w - 2 * GEOPDF_PADDING_MM;

  const { north, south, east, west } = config.extent;
  const extent = config.extent;
  const geometry = printGeometry(config);
  const { centreLat, zoom, nativeW, nativeH, overlayZoom } = geometry;
  const baseLayerCfg = GEOPDF_BASE_LAYER_CONFIG[config.baseLayer];
  const styleZoom = displayZoomForScale(config.scale, centreLat);
  timings.mapPx = [nativeW, nativeH];

  // The cap, then this browser's limits: either refuses before a tile is asked for.
  if (
    !(nativeW > 0 && nativeH > 0) ||
    nativeW * nativeH * 4 > GEOPDF_MAX_CANVAS_BYTES
  ) {
    throw new TooLarge();
  }
  let limits = debug?.limits ?? env.limits;
  let probedNow = false;
  if (!limits) {
    limits = await probeCanvasLimits();
    env.onLimits(limits);
    probedNow = true;
  }
  check();
  let plan = checkPlan(nativeW, nativeH, limits);
  if (!plan.ok && !probedNow && !debug?.limits) {
    // The cached limits never expire, and a browser update or a freer device
    // can raise them: probe once more before refusing, and let the client
    // keep what this finds.
    limits = await probeCanvasLimits();
    env.onLimits(limits);
    check();
    plan = checkPlan(nativeW, nativeH, limits);
  }
  if (!plan.ok) throw new TooLarge();
  let strips: Strip[] = plan.strips;
  if (debug?.maxStripPx)
    strips = planStrips(nativeW, nativeH, debug.maxStripPx);
  timings.strips = strips.length;

  const elementDpi = (nativeW / mapWidthMm) * MM_PER_INCH;
  const vectorPxScale = elementDpi / STYLE_DPI;
  const transform = computeTileToMapTransform(
    zoom,
    north,
    south,
    east,
    west,
    nativeW,
    nativeH,
  );
  const overlayTransform = computeTileToMapTransform(
    overlayZoom,
    north,
    south,
    east,
    west,
    nativeW,
    nativeH,
  );

  // ── Progress ─────────────────────────────────────────────────────────────
  const total = strips.length;
  const totalRows = strips.reduce((n, s) => n + s.height, 0);
  let phase: GeoPdfProgress["phase"] = "preparing";
  let prepared = 0;
  let rowsDone = 0;
  let stripsDone = 0;
  let finished = 0;
  let lastFraction = 0;
  let lastPosted = 0;
  const fetcher = new TileFetcher(signal, input.origin);
  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastPosted < 100) return;
    lastPosted = now;
    const s = fetcher.scheduler;
    const fetchShare = s.scheduled ? s.settled / s.scheduled : 0;
    const fraction =
      W_PREPARE * prepared +
      W_FETCH * fetchShare * (phase === "preparing" ? 0 : 1) +
      W_DRAW * (rowsDone / totalRows) +
      W_FINISH * finished;
    lastFraction = Math.max(lastFraction, Math.min(fraction, 1));
    env.onProgress({ phase, done: stripsDone, total, fraction: lastFraction });
  };
  fetcher.scheduler.onSettle = () => report();

  // ── What is drawn, and from where ────────────────────────────────────────
  const drawn = overlaysDrawn(config);
  const wantSlope = config.overlays.includes("slope");
  const wantVegetation =
    config.overlays.includes("vegetation") && input.vegetationUrls.length > 0;
  const areas = areasOnPage(input.areas, extent);
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const contourZoom = nswContourZoom(config.scale, centreLat, overlayZoom);
  const wantContours = contourZoom !== null && drawn.contours;
  const baseExtractedAt = new Date();

  const statewideUrl = (path: string) => `${input.origin}/${path}`;
  const areaUrl = (a: SharpenedOverlay, layer: TerrainArchiveLayer) =>
    layer === "heights"
      ? a.heightsUrl
      : layer === "slope"
        ? a.slopeUrl
        : a.contoursUrl;

  // One PMTiles instance per archive per render.
  const archives = new Map<string, PMTiles>();
  const archiveAt = (url: string) => {
    let a = archives.get(url);
    if (!a) {
      a = openArchive(url, signal, {
        store: env.cache ?? null,
        origin: input.origin,
      });
      archives.set(url, a);
    }
    return a;
  };
  const statewide: Partial<Record<TerrainArchiveLayer, string | null>> = {};

  const fontsReady = loadMapFonts(signal);
  // A statewide archive that will not open leaves its layer off the map and
  // out of the credits; an area's archives are tried tile by tile.
  const openStatewide = async (layer: TerrainArchiveLayer, path: string) => {
    const url = statewideUrl(path);
    statewide[layer] = (await fetcher.open(archiveAt(url), url)) ? url : null;
  };
  await Promise.all([
    fontsReady,
    drawn.hillshade
      ? openStatewide("heights", NSW_HILLSHADE.archivePath)
      : null,
    wantSlope ? openStatewide("slope", NSW_SLOPE.archivePath) : null,
    wantContours ? openStatewide("contours", NSW_CONTOURS.archivePath) : null,
  ]);
  check();

  /** The archive a read comes from: [url, instance], or null. */
  const sourceArchive = (layer: TerrainArchiveLayer, source: string) => {
    let url: string | null | undefined;
    if (source === STATEWIDE) url = statewide[layer];
    else {
      const a = areaById.get(source);
      url = a ? areaUrl(a, layer) : null;
    }
    return url ? ([url, archiveAt(url)] as const) : null;
  };

  const spans = new Map<string, { start: number; end: number; n: number }>();
  const track = <T>(layer: string, p: Promise<T>): Promise<T> => {
    const span = spans.get(layer) ?? { start: performance.now(), end: 0, n: 0 };
    span.n++;
    spans.set(layer, span);
    return p.finally(() => {
      span.end = performance.now();
    });
  };
  // Strips needing a row range, first and last.
  const stripsReaching = (top: number, bottom: number) => {
    let first = -1;
    let last = -1;
    for (const s of strips) {
      const rows = drawnRows(s);
      if (rows.from < bottom && rows.to > top) {
        if (first < 0) first = s.index;
        last = s.index;
      }
    }
    return [first, last] as const;
  };

  // Base tiles.
  const baseEntries: TileEntry[] = [];
  if (baseLayerCfg) {
    for (const tile of transform.tiles) {
      const rect = tileRect(tile, transform);
      const [first, last] = stripsReaching(rect.y, rect.y + rect.h);
      if (first < 0) continue;
      const url = baseLayerCfg.urlTemplate
        .replace("{z}", String(tile.z))
        .replace("{y}", String(tile.y))
        .replace("{x}", String(tile.x));
      baseEntries.push({
        tile,
        rect,
        first,
        last,
        promise: track(
          "base",
          fetcher.http(url, first * PER_STRIP + RANK.base),
        ),
      });
    }
  }
  const baseOutcome = { loaded: 0 };
  void Promise.all(
    baseEntries.map((e) =>
      e.promise!.then((b) => {
        if (b) baseOutcome.loaded++;
      }),
    ),
  ).catch(() => {});

  // Terrain layers.
  const drawnTerrain = new Set<TerrainLayerKey>();
  const drawnAreas = new Map<SharpenedOverlay, Set<TerrainLayerKey>>();
  const creditAreas = (layer: TerrainLayerKey, sources: Iterable<string>) => {
    for (const source of sources) {
      const area = areaById.get(source);
      if (!area) continue;
      const layers = drawnAreas.get(area) ?? new Set<TerrainLayerKey>();
      layers.add(layer);
      drawnAreas.set(area, layers);
    }
  };
  const creditReads: Promise<unknown>[] = [];

  const planTerrain = (
    key: "hillshade" | "slope",
    archiveLayer: "heights" | "slope",
    smooth: boolean,
  ): TerrainPlan => {
    const { demZoom, t, cols, read, blocks } = planTerrainBlocks(
      config,
      geometry,
      areas,
      archiveLayer,
      strips.map(drawnRows),
    );
    const entries = new Map<string, TerrainEntry>();
    const firstOf = new Map<string, number>();
    for (const strip of strips) {
      const { reads } = blocks[strip.index]!;
      for (const r of reads) {
        const k = terrainReadKey(r);
        if (!firstOf.has(k)) firstOf.set(k, strip.index);
        const e = entries.get(k);
        if (e) e.last = strip.index;
      }
      // Entries are created in the first strip that reads them.
      for (const r of reads) {
        const k = terrainReadKey(r);
        if (entries.has(k)) continue;
        const src = sourceArchive(archiveLayer, r.source);
        const first = firstOf.get(k)!;
        const entry: TerrainEntry = {
          read: r,
          last: strip.index,
          promise: Promise.resolve(),
          bytes: null,
          status: UNKNOWN,
          settled: null,
          decoded: null,
        };
        if (src) {
          entry.promise = track(
            key,
            fetcher.archive(
              src[1],
              src[0],
              r.z,
              r.x,
              r.y,
              first * PER_STRIP + RANK[key],
            ),
          ).then((b) => {
            entry.bytes = b;
          });
        }
        entries.set(k, entry);
        creditReads.push(entry.promise);
      }
    }
    return {
      key,
      smooth,
      zoom: demZoom,
      t,
      cols,
      read,
      entries,
      blocks,
      credited: new Set<string>(),
      arrived: 0,
      decodedOk: 0,
    };
  };

  const terrainPlans: TerrainPlan[] = [];
  if (drawn.hillshade && statewide.heights !== undefined) {
    // A statewide archive that failed to open leaves `null`: areas still draw.
    terrainPlans.push(planTerrain("hillshade", "heights", true));
  }
  if (wantSlope && statewide.slope !== undefined) {
    terrainPlans.push(planTerrain("slope", "slope", false));
  }
  // Started now, so the helpers load while the tiles arrive; a print with no
  // terrain starts none.
  const pool =
    terrainPlans.length > 0
      ? new TerrainPool({
          count: debug?.noPool ? 0 : debug?.poolSize,
          failFirst: debug?.failHelper,
        })
      : null;
  cleanups.push(() => pool?.terminate());
  // Contours: every tile is read and decoded before the first strip, as the
  // labels are placed over the whole map.
  type ContourRead = {
    source: string;
    tile: TileCoord;
    promise: Promise<TileBytes>;
  };
  const contourReads: ContourRead[] = [];
  const contourTransform =
    wantContours && contourZoom !== null
      ? computeTileToMapTransform(
          contourZoom,
          north,
          south,
          east,
          west,
          nativeW,
          nativeH,
        )
      : null;
  if (contourTransform) {
    for (const [source, tiles] of contourTilesBySource(
      areas,
      contourTransform.tiles,
    )) {
      const src = sourceArchive("contours", source);
      if (!src) continue;
      for (const tile of tiles) {
        const promise = track(
          "contours",
          fetcher.archive(
            src[1],
            src[0],
            tile.z,
            tile.x,
            tile.y,
            RANK.contours,
          ),
        );
        contourReads.push({ source, tile, promise });
        creditReads.push(promise.then(() => undefined));
      }
    }
  }

  // Vegetation: the owner's jobs, oldest first, each over the overlay zoom.
  const vegetation: { entries: TileEntry[]; drew: { any: boolean } }[] = [];
  if (wantVegetation) {
    for (const url of input.vegetationUrls) {
      const archive = archiveAt(url);
      const entries: TileEntry[] = [];
      const state = { entries, drew: { any: false } };
      for (const tile of overlayTransform.tiles) {
        const rect = tileRect(tile, overlayTransform);
        const [first, last] = stripsReaching(rect.y, rect.y + rect.h);
        if (first < 0) continue;
        const promise = track(
          "vegetation",
          fetcher.archive(
            archive,
            url,
            tile.z,
            tile.x,
            tile.y,
            first * PER_STRIP + RANK.vegetation,
          ),
        ).then((b) => {
          if (b) state.drew.any = true;
          return b;
        });
        entries.push({ tile, rect, first, last, promise });
        creditReads.push(promise.then(() => undefined));
      }
      vegetation.push(state);
    }
  }

  // Everything is asked for; the contours, being small, come first.
  const contourInputs: ContourTileInput[] = [];
  for (const r of contourReads) {
    const data = await r.promise;
    if (data)
      contourInputs.push({ source: r.source, x: r.tile.x, y: r.tile.y, data });
  }
  check();
  const contours =
    contourTransform && contourInputs.length > 0
      ? buildContours(
          contourInputs,
          contourTransform,
          styleZoom,
          vectorPxScale,
          nswContourStyle(config.baseLayer),
        )
      : null;
  if (contours) {
    for (const source of contours.sources) creditAreas("contours", [source]);
    if (contours.sources.size > 0) drawnTerrain.add("contours");
  }
  contourInputs.length = 0;

  // The credits' upper bound, to find the strips that wait for every read.
  const measure = new OffscreenCanvas(1, 1).getContext("2d")!;
  const margin = mmToPx(5, elementDpi);
  const upperTerrain = new Set<TerrainLayerKey>();
  if (terrainPlans.some((p) => p.key === "hillshade"))
    upperTerrain.add("hillshade");
  if (terrainPlans.some((p) => p.key === "slope")) upperTerrain.add("slope");
  if (contourReads.length > 0) upperTerrain.add("contours");
  const credit = (
    terrainLines: readonly string[],
    renderedOverlays: readonly string[],
  ): AttributionInput => ({
    baseLayer: config.baseLayer,
    renderedOverlays,
    terrainLines,
    extractedAt: baseExtractedAt,
  });
  const upperLines = attributionLines(
    measure,
    nativeW,
    elementDpi,
    credit(
      upperBoundTerrainLines(upperTerrain, areas),
      wantVegetation ? ["vegetation"] : [],
    ),
  );
  const upperBlock = attributionRows(
    upperLines.length,
    nativeH,
    margin,
    elementDpi,
  );

  timings.prepareMs = performance.now() - t0;
  prepared = 1;
  report(true);

  // ── Strips ───────────────────────────────────────────────────────────────
  const decodeImage = (bytes: ArrayBuffer) =>
    createImageBitmap(new Blob([bytes])).catch(() => null);

  /**
   * Decode an arrived terrain tile once, on a helper: it is then usable (and
   * credited), or unreadable for good; the compressed bytes are let go either
   * way. Kept decoded only if a strip from `keepFrom` on still reads it.
   */
  const settleDecode = (p: TerrainPlan, e: TerrainEntry, keepFrom: number) =>
    (e.settled ??= (async () => {
      const bytes = e.bytes;
      e.bytes = null;
      if (!bytes) {
        e.status = EMPTY;
        return;
      }
      p.arrived++;
      const values = await pool!.decode(bytes);
      if (!values) {
        e.status = BAD;
        return;
      }
      e.status = OK;
      p.decodedOk++;
      p.credited.add(e.read.source);
      if (e.last >= keepFrom) e.decoded = values;
    })());

  /**
   * A strip's hillshade or slope, as bands of RGBA from the helpers, or null
   * where none of its tiles decoded. Runs while this worker draws the base.
   */
  const paintTerrain = async (
    p: TerrainPlan,
    strip: Strip,
    span: { from: number; to: number },
  ): Promise<TerrainBands | null> => {
    const start = performance.now();
    const block = p.blocks[strip.index]!;
    const entries = block.reads.map((r) => p.entries.get(terrainReadKey(r))!);
    await Promise.all(entries.map((e) => settleDecode(p, e, strip.index)));
    if (!entries.some((e) => e.status === OK)) return null;
    bump(`${p.key}.decode`, start);
    const decoded = new Map<string, Float32Array>();
    for (const [k, e] of p.entries) if (e.decoded) decoded.set(k, e.decoded);
    const grid = terrainGrid(
      p.zoom,
      p.t.minTileX,
      p.t.minTileY + block.r0,
      p.cols,
      block.r1 - block.r0 + 1,
      p.read,
      decoded,
      p.smooth,
    );
    // More bands than helpers, so a fast core takes another while a slow one
    // finishes its first.
    const canvasH = span.to - span.from;
    const n = Math.min(Math.max(1, pool!.size * BANDS_PER_HELPER), canvasH);
    const bands = [];
    for (let i = 0; i < n; i++) {
      const y0 = Math.floor((canvasH * i) / n);
      const outH = Math.floor((canvasH * (i + 1)) / n) - y0;
      const rows = bandRows(
        p.t,
        block.r0 * TILE_SIZE,
        grid.height,
        span.from + y0,
        outH,
      );
      const band = pool!.band({
        kind: p.key,
        values: grid.values.subarray(
          rows.from * grid.width,
          rows.to * grid.width,
        ),
        width: grid.width,
        gridRow0: rows.from,
        blockRow0: block.r0 * TILE_SIZE,
        zoom: p.zoom,
        tileY: p.t.minTileY + block.r0,
        bands: input.slopeBands,
        place: {
          scaleX: p.t.scaleX,
          scaleY: p.t.scaleY,
          offsetX: p.t.offsetX,
          offsetY: p.t.offsetY,
        },
        smooth: p.smooth,
        outW: nativeW,
        outY: span.from + y0,
        outH,
      });
      bands.push(band.then((rgba) => ({ y: y0, rows: outH, rgba })));
    }
    const out = await Promise.all(bands);
    bump(`${p.key}.pixels`, start);
    return out;
  };

  const jpegs: GeoPdfPageInput["strips"] = [];
  const stripPixels: {
    y: number;
    rows: number;
    owned: number;
    data: ArrayBuffer;
  }[] = [];
  let credited = false;
  const bump = (name: string, since: number) => {
    timings.drawBreakdownMs[name] =
      (timings.drawBreakdownMs[name] ?? 0) + (performance.now() - since);
    // The client's watchdog hears from a live render between layers too.
    report();
  };
  const place = {
    markers: config.placeMarkers && config.placeMarkers.length > 0,
  };

  /**
   * A strip's terrain, started once its own tiles are in: the helpers decode
   * and paint it while this worker waits for the base tiles and draws them.
   * The next strip's starts as soon as this one's is drawn, so the helpers
   * work through this strip's encode too; no further ahead, as a strip's
   * bands are a canvas's worth of RGBA per layer.
   */
  const terrainOf = new Map<number, (Promise<TerrainBands | null> | null)[]>();
  const startTerrain = (strip: Strip) => {
    let work = terrainOf.get(strip.index);
    if (!work) {
      const started = terrainPlans.map(async (p) => {
        await Promise.all(
          p.blocks[strip.index]!.reads.map(
            (r) => p.entries.get(terrainReadKey(r))!.promise,
          ),
        );
        check();
        return paintTerrain(p, strip, drawnRows(strip));
      });
      // Awaited in layer order when drawn; an abort first must not leave a
      // rejection unheard.
      for (const w of started) w.catch(() => {});
      work = started;
      terrainOf.set(strip.index, work);
    }
    return work;
  };

  for (const strip of strips) {
    check();
    phase = "drawing";
    report(true);
    const terrainWork = startTerrain(strip);
    const waitStart = performance.now();
    const myBase = baseEntries.filter(
      (e) => e.first <= strip.index && e.last >= strip.index,
    );
    const myVeg = vegetation.map((v) =>
      v.entries.filter((e) => e.first <= strip.index && e.last >= strip.index),
    );
    // Nothing else is waited for here: each layer waits for its own tiles
    // as it is drawn, so the base draws while the rest of it arrives.
    // The attribution names what drew, which only the last read knows.
    const reachesCredits = strip.y + strip.renderHeight > upperBlock.top;
    const span = drawnRows(strip);
    const canvasH = span.to - span.from;
    if (reachesCredits && !credited) {
      await Promise.all(creditReads);
      // What is credited is what decoded, so every terrain tile is tried now.
      for (const p of terrainPlans) {
        await Promise.all(
          [...p.entries.values()].map((e) => settleDecode(p, e, strip.index)),
        );
        // A layer whose every tile is unreadable is a failure, not a layer
        // quietly missing from the map.
        if (p.arrived > 0 && p.decodedOk === 0)
          throw new Error("terrain tiles unreadable");
      }
      credited = true;
    }
    check();
    timings.fetchWaitMs += performance.now() - waitStart;

    const drawStart = performance.now();
    // Time in the draw spent waiting for tiles: counted as fetch wait.
    let drawWaitMs = 0;
    const waitFor = async (batch: TileEntry[]) => {
      const start = performance.now();
      await Promise.all(batch.map((e) => e.promise));
      check();
      const waited = performance.now() - start;
      timings.fetchWaitMs += waited;
      drawWaitMs += waited;
      return waited;
    };
    let canvas: OffscreenCanvas;
    let ctx: Ctx | null;
    try {
      canvas = new OffscreenCanvas(nativeW, canvasH);
      ctx = canvas.getContext("2d") as Ctx | null;
    } catch {
      throw new TooLarge();
    }
    if (!ctx) throw new TooLarge();
    let scratch: OffscreenCanvas | null = null;
    let cropped: OffscreenCanvas | null = null;
    try {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, nativeW, canvasH);
      ctx.setTransform(1, 0, 0, 1, 0, -span.from);
      const top = span.from;
      const bottom = span.to;

      // 1. Base tiles, in tile order, decoded a few at a time, each batch
      // drawn as soon as it is in.
      let mark = performance.now();
      const rows = myBase.filter((e) => reachesRows(e.rect, top, bottom));
      for (let i = 0; i < rows.length; i += DECODE_BATCH) {
        const batch = rows.slice(i, i + DECODE_BATCH);
        mark += await waitFor(batch);
        const images = await Promise.all(
          batch.map(async (e) => {
            const bytes = await e.promise!;
            return bytes ? decodeImage(bytes) : null;
          }),
        );
        batch.forEach((e, j) => {
          const img = images[j];
          if (img) {
            drawTile(ctx, img, e.rect);
            img.close();
          } else drawMissingTile(ctx, e.rect);
        });
      }
      for (const e of baseEntries) if (e.last <= strip.index) e.promise = null;
      bump("base", mark);

      // 2. Terrain: hillshade, then slope.
      for (const [i, p] of terrainPlans.entries()) {
        mark = performance.now();
        const bands = await terrainWork[i]!;
        // Let go as soon as drawn; the other layer's may still be painting.
        terrainWork[i] = null;
        check();
        if (bands) {
          scratch ??= new OffscreenCanvas(nativeW, canvasH);
          const sctx = scratch.getContext("2d")!;
          for (const b of bands)
            sctx.putImageData(
              new ImageData(
                b.rgba as Uint8ClampedArray<ArrayBuffer>,
                nativeW,
                b.rows,
              ),
              0,
              b.y,
            );
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(scratch, 0, 0);
          ctx.restore();
        }
        // Tiles no later strip reads are let go.
        for (const e of p.entries.values())
          if (e.last <= strip.index) e.decoded = null;
        bump(p.key, mark);
      }
      terrainOf.delete(strip.index);
      if (scratch) scratch.width = scratch.height = 0;
      scratch = null;

      // 3. Contour lines, then vegetation, then the labels over both.
      mark = performance.now();
      if (contours) drawContourLines(ctx, contours, top, bottom);
      bump("contours", mark);
      mark = performance.now();
      for (const entries of myVeg) {
        const mine = entries.filter((e) => reachesRows(e.rect, top, bottom));
        for (let i = 0; i < mine.length; i += DECODE_BATCH) {
          const batch = mine.slice(i, i + DECODE_BATCH);
          mark += await waitFor(batch);
          const images = await Promise.all(
            batch.map(async (e) => {
              const bytes = await e.promise!;
              return bytes ? decodeImage(bytes) : null;
            }),
          );
          batch.forEach((e, j) => {
            const img = images[j];
            if (!img) return;
            drawTile(ctx, img, e.rect);
            img.close();
          });
        }
      }
      for (const v of vegetation)
        for (const e of v.entries) if (e.last <= strip.index) e.promise = null;
      bump("vegetation", mark);
      mark = performance.now();
      if (contours) drawContourLabels(ctx, contours, top, bottom);
      bump("labels", mark);

      // 4. Map elements.
      mark = performance.now();
      if (place.markers)
        drawPlaceMarkers(ctx, config, nativeW, nativeH, elementDpi);
      if (config.elements.gridLines)
        drawGridLines(ctx, config, nativeW, nativeH, elementDpi);
      const padH = mmToPx(2, elementDpi);
      const padV = mmToPx(1.5, elementDpi);
      let stackY = nativeH - margin;
      if (config.elements.scaleBar)
        stackY = drawScaleBar(
          ctx,
          config,
          nativeW,
          stackY,
          margin,
          padH,
          padV,
          elementDpi,
        );
      if (config.elements.scaleText)
        stackY = drawScaleText(
          ctx,
          config,
          stackY,
          margin,
          padH,
          padV,
          elementDpi,
        );
      if (config.elements.compass)
        drawCompass(ctx, config, stackY, margin, elementDpi);
      if (config.elements.title)
        drawTitle(ctx, config.elements.title, margin, padH, padV, elementDpi);
      if (reachesCredits) {
        // Credit only what painted data.
        const renderedOverlays: string[] = [];
        if (vegetation.some((v) => v.drew.any))
          renderedOverlays.push("vegetation");
        const terrain = new Set<TerrainLayerKey>(drawnTerrain);
        for (const p of terrainPlans) {
          if (p.credited.size > 0) terrain.add(p.key);
          creditAreas(p.key, p.credited);
        }
        drawAttribution(
          ctx,
          nativeW,
          nativeH,
          margin,
          elementDpi,
          credit(terrainCreditLines(terrain, drawnAreas), renderedOverlays),
        );
      }
      bump("elements", mark);
      timings.drawMs += performance.now() - drawStart - drawWaitMs;

      // 5. The strip must have drawn: Safari fails a canvas past its limit
      // silently, reading back transparent black.
      // Crop the halo off. The terrain scratch canvas is already let go, so
      // no more canvases are alive than peakCanvasPx counts.
      let out = canvas;
      if (span.above > 0) {
        cropped = new OffscreenCanvas(nativeW, strip.renderHeight);
        const cctx = cropped.getContext("2d");
        if (!cctx) throw new TooLarge();
        cctx.drawImage(canvas, 0, -span.above);
        canvas.width = canvas.height = 0;
        out = cropped;
      }
      const octx = out.getContext("2d")!;
      const opaque = (x: number, y: number) =>
        octx.getImageData(x, y, 1, 1).data[3] === 255;
      if (
        debug?.failPixelCheck ||
        !opaque(nativeW - 1, strip.renderHeight - 1) ||
        !opaque(0, 0)
      ) {
        throw new TooLarge();
      }
      if (debug?.collectPixels) {
        // Every rendered row, the overlap under the next strip too.
        const all = octx.getImageData(0, 0, nativeW, strip.renderHeight).data;
        stripPixels.push({
          y: strip.y,
          rows: strip.renderHeight,
          owned: strip.height,
          data: all.buffer as ArrayBuffer,
        });
      }

      // 6. JPEG.
      const encodeStart = performance.now();
      let blob: Blob;
      try {
        blob = await out.convertToBlob({
          type: JPEG_TYPE,
          quality: JPEG_QUALITY,
        });
      } catch {
        throw new TooLarge();
      }
      if (blob.type !== JPEG_TYPE) throw new TooLarge();
      jpegs.push({
        jpeg: new Uint8Array(await blob.arrayBuffer()),
        y: strip.y,
        height: strip.height,
        renderHeight: strip.renderHeight,
      });
      timings.encodeMs += performance.now() - encodeStart;
    } finally {
      // Resizing frees the surfaces now, not at the next collection.
      canvas.width = canvas.height = 0;
      if (scratch) scratch.width = scratch.height = 0;
      if (cropped) cropped.width = cropped.height = 0;
    }
    rowsDone += strip.height;
    stripsDone++;
    report(true);
  }

  // A map of grey squares is not a map.
  if (baseEntries.length > 0 && baseOutcome.loaded === 0) {
    throw new Error("no base tile loaded");
  }

  // ── The PDF ──────────────────────────────────────────────────────────────
  phase = "finishing";
  report(true);
  const pdfStart = performance.now();
  // The cache keeps its index while the PDF is written; the client ends the
  // worker as soon as the PDF is back.
  const cacheFlushed = env.cache?.flush();
  const pdf = await buildGeoPdf({
    pageWidthPt: widthPt,
    pageHeightPt: heightPt,
    paddingPt,
    mapWidthPx: nativeW,
    mapHeightPx: nativeH,
    strips: jpegs,
    extent,
    title: config.elements.title,
  });
  await cacheFlushed;
  timings.pdfMs = performance.now() - pdfStart;
  finished = 1;
  report(true);

  for (const [layer, span] of spans) {
    timings.fetchSpanMs[layer] = Math.round(span.end - span.start);
    timings.requests[layer] = span.n;
  }
  timings.helperBands = pool?.helperBands ?? 0;
  timings.totalMs = performance.now() - t0;
  return {
    pdf,
    timings,
    pixels: debug?.collectPixels
      ? { width: nativeW, height: nativeH, strips: stripPixels }
      : undefined,
  };
}
