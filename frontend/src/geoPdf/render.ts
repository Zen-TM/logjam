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
// one-strip one pixel for pixel.
//
// PRIVACY: nothing here logs. See tiles.ts.
import {
  computeTileToMapTransform,
  computeZoom,
  GEOPDF_BASE_LAYER_CONFIG,
  GEOPDF_MAX_CANVAS_BYTES,
  GEOPDF_PADDING_MM,
  geoPdfMaxNativeZoom,
  getPaperDimensions,
  NSW_CONTOURS,
  NSW_HILLSHADE,
  NSW_SLOPE,
  nswContourStyle,
  TARGET_DPI,
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
import { planStrips, STRIP_OVERLAP_ROWS, type Strip } from "./strips";
import {
  areasOnPage,
  contourTilesBySource,
  decodeTerrarium,
  demBlockRows,
  hillshadePixels,
  nswContourZoom,
  overlaysDrawn,
  resampleGrid,
  slopePixels,
  STATEWIDE,
  terrainCreditLines,
  terrainGrid,
  terrainReadKey,
  terrainReadZoom,
  terrainTileReader,
  terrainTileReads,
  type DemGrid,
  type TerrainTileRead,
} from "./terrain";
import { openArchive, TileFetcher, type TileBytes } from "./tiles";
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
};

export type RenderOutput = {
  pdf: Uint8Array;
  timings: RenderTimings;
  pixels?: { width: number; height: number; data: ArrayBuffer };
};

const JPEG_QUALITY = 0.95;
const JPEG_TYPE = "image/jpeg";
/** Base tiles decoded at once (each is a 256 KB bitmap). */
const DECODE_BATCH = 8;

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

type TerrainEntry = {
  read: TerrainTileRead;
  last: number;
  promise: Promise<TileBytes>;
  decoded: Float32Array | null;
};

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
  drew: Set<string>;
  paint: (
    grid: DemGrid,
    zoom: number,
    tileY: number,
    out: Uint8ClampedArray,
  ) => Uint8ClampedArray;
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
  const above = s.y > 0 ? STRIP_OVERLAP_ROWS : 0;
  return { from: s.y - above, to: s.y + s.renderHeight, above };
};

export async function renderGeoPdf(
  input: GeoPdfRenderInput,
  env: RenderEnv,
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
  const centreLat = (north + south) / 2;
  const baseLayerCfg = GEOPDF_BASE_LAYER_CONFIG[config.baseLayer];
  const maxNativeZoom = geoPdfMaxNativeZoom(config.baseLayer);
  const zoom = computeZoom(config.scale, centreLat, TARGET_DPI, maxNativeZoom);
  const styleZoom = displayZoomForScale(config.scale, centreLat);
  const probe = computeTileToMapTransform(zoom, north, south, east, west, 1, 1);
  const nativeW = Math.round(probe.srcW);
  const nativeH = Math.round(probe.srcH);
  timings.mapPx = [nativeW, nativeH];

  // The cap, then this browser's limits: either refuses before a tile is asked for.
  if (
    !(nativeW > 0 && nativeH > 0) ||
    nativeW * nativeH * 4 > GEOPDF_MAX_CANVAS_BYTES
  ) {
    throw new TooLarge();
  }
  let limits = debug?.limits ?? env.limits;
  if (!limits) {
    limits = await probeCanvasLimits();
    env.onLimits(limits);
  }
  check();
  const plan = checkPlan(nativeW, nativeH, limits);
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
  const overlayZoom = computeZoom(config.scale, centreLat, TARGET_DPI, 18);
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
      a = openArchive(url, signal);
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
    maxzoom: number,
    smooth: boolean,
    paint: TerrainPlan["paint"],
  ): TerrainPlan => {
    const demZoom = terrainReadZoom(
      Math.min(zoom, overlayZoom),
      maxzoom,
      areas,
    );
    const t = computeTileToMapTransform(
      demZoom,
      north,
      south,
      east,
      west,
      nativeW,
      nativeH,
    );
    const last = t.tiles[t.tiles.length - 1]!;
    const cols = last.x - t.minTileX + 1;
    const rows = last.y - t.minTileY + 1;
    const read = terrainTileReader(areas, archiveLayer);
    const entries = new Map<string, TerrainEntry>();
    const drew = new Set<string>();
    const blocks: TerrainPlan["blocks"] = [];
    const firstOf = new Map<string, number>();
    for (const strip of strips) {
      const span = drawnRows(strip);
      const { r0, r1 } = demBlockRows(span.from, span.to, t, rows);
      const tiles: TileCoord[] = [];
      for (let r = r0; r <= r1; r++)
        for (let c = 0; c < cols; c++)
          tiles.push({ z: demZoom, x: t.minTileX + c, y: t.minTileY + r });
      const reads = terrainTileReads(tiles, demZoom, read, smooth);
      blocks.push({ r0, r1, reads });
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
        const promise = src
          ? track(
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
              if (b) drew.add(r.source);
              return b;
            })
          : Promise.resolve(null);
        entries.set(k, { read: r, last: strip.index, promise, decoded: null });
        creditReads.push(promise);
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
      drew,
      paint,
    };
  };

  const terrainPlans: TerrainPlan[] = [];
  if (drawn.hillshade && statewide.heights !== undefined) {
    // A statewide archive that failed to open leaves `null`: areas still draw.
    terrainPlans.push(
      planTerrain(
        "hillshade",
        "heights",
        NSW_HILLSHADE.maxzoom,
        true,
        hillshadePixels,
      ),
    );
  }
  if (wantSlope && statewide.slope !== undefined) {
    terrainPlans.push(
      planTerrain(
        "slope",
        "slope",
        NSW_SLOPE.maxzoom,
        false,
        (grid, _z, _y, out) => slopePixels(grid, input.slopeBands, out),
      ),
    );
  }
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
        creditReads.push(promise);
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
        creditReads.push(promise);
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
  const upperAreas = new Map(
    areas.map((a) => [a, new Set(upperTerrain)] as const),
  );
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
      terrainCreditLines(upperTerrain, upperAreas),
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
  const tileCanvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const tileCtx = tileCanvas.getContext("2d", { willReadFrequently: true })!;
  const decodeTerrainTile = async (bytes: ArrayBuffer) => {
    try {
      const bmp = await createImageBitmap(new Blob([bytes]), {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
      });
      tileCtx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
      tileCtx.drawImage(bmp, 0, 0);
      bmp.close();
      const { data } = tileCtx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
      return decodeTerrarium(data, TILE_SIZE, TILE_SIZE).values;
    } catch {
      return null;
    }
  };
  const decodeImage = (bytes: ArrayBuffer) =>
    createImageBitmap(new Blob([bytes])).catch(() => null);

  const jpegs: GeoPdfPageInput["strips"] = [];
  const pixelsOut = debug?.collectPixels
    ? new Uint8Array(nativeW * nativeH * 4)
    : null;
  let credited = false;
  const bump = (name: string, since: number) => {
    timings.drawBreakdownMs[name] =
      (timings.drawBreakdownMs[name] ?? 0) + (performance.now() - since);
  };
  const place = {
    markers: config.placeMarkers && config.placeMarkers.length > 0,
  };

  for (const strip of strips) {
    check();
    phase = "drawing";
    report(true);
    const waitStart = performance.now();
    const myBase = baseEntries.filter(
      (e) => e.first <= strip.index && e.last >= strip.index,
    );
    // The strip waits for what it draws from.
    const myVeg = vegetation.map((v) =>
      v.entries.filter((e) => e.first <= strip.index && e.last >= strip.index),
    );
    await Promise.all([
      ...myBase.map((e) => e.promise),
      ...terrainPlans.flatMap((p) =>
        p.blocks[strip.index]!.reads.map(
          (r) => p.entries.get(terrainReadKey(r))!.promise,
        ),
      ),
      ...myVeg.flat().map((e) => e.promise),
    ]);
    // The attribution names what drew, which only the last read knows.
    const reachesCredits = strip.y + strip.renderHeight > upperBlock.top;
    const span = drawnRows(strip);
    const canvasH = span.to - span.from;
    if (reachesCredits && !credited) {
      await Promise.all(creditReads);
      credited = true;
    }
    check();
    timings.fetchWaitMs += performance.now() - waitStart;

    const drawStart = performance.now();
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

      // 1. Base tiles, in tile order, decoded a few at a time.
      let mark = performance.now();
      const rows = myBase.filter((e) => reachesRows(e.rect, top, bottom));
      for (let i = 0; i < rows.length; i += DECODE_BATCH) {
        const batch = rows.slice(i, i + DECODE_BATCH);
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
      for (const p of terrainPlans) {
        mark = performance.now();
        const block = p.blocks[strip.index]!;
        const present = block.reads.some(
          (r) => p.drew.has(r.source) && p.entries.get(terrainReadKey(r)),
        );
        if (present) {
          for (const r of block.reads) {
            const e = p.entries.get(terrainReadKey(r))!;
            if (e.decoded) continue;
            const bytes = await e.promise;
            if (bytes) e.decoded = await decodeTerrainTile(bytes);
          }
          const decoded = new Map<string, Float32Array>();
          for (const [k, e] of p.entries)
            if (e.decoded) decoded.set(k, e.decoded);
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
          const pixels = p.paint(
            grid,
            p.zoom,
            p.t.minTileY + block.r0,
            new Uint8ClampedArray(grid.width * grid.height * 4),
          );
          const rgba = resampleGrid(
            pixels,
            grid.width,
            grid.height,
            block.r0 * TILE_SIZE,
            p.t,
            p.smooth,
            nativeW,
            span.from,
            canvasH,
          );
          scratch ??= new OffscreenCanvas(nativeW, canvasH);
          const sctx = scratch.getContext("2d")!;
          sctx.putImageData(new ImageData(rgba, nativeW, canvasH), 0, 0);
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

      // 3. Contour lines, then vegetation, then the labels over both.
      mark = performance.now();
      if (contours) drawContourLines(ctx, contours, top, bottom);
      bump("contours", mark);
      mark = performance.now();
      for (const entries of myVeg) {
        const mine = entries.filter((e) => reachesRows(e.rect, top, bottom));
        for (let i = 0; i < mine.length; i += DECODE_BATCH) {
          const batch = mine.slice(i, i + DECODE_BATCH);
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
          if (p.drew.size > 0) terrain.add(p.key);
          creditAreas(p.key, p.drew);
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
      timings.drawMs += performance.now() - drawStart;

      // 5. The strip must have drawn: Safari fails a canvas past its limit
      // silently, reading back transparent black.
      // Crop the halo off. The terrain scratch canvas is let go first, so no
      // more canvases are alive than peakCanvasPx counts.
      let out = canvas;
      if (span.above > 0) {
        if (scratch) scratch.width = scratch.height = 0;
        scratch = null;
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
      if (pixelsOut) {
        const owned = octx.getImageData(0, 0, nativeW, strip.height).data;
        pixelsOut.set(owned, strip.y * nativeW * 4);
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
  tileCanvas.width = tileCanvas.height = 0;

  // A map of grey squares is not a map.
  if (baseEntries.length > 0 && baseOutcome.loaded === 0) {
    throw new Error("no base tile loaded");
  }

  // ── The PDF ──────────────────────────────────────────────────────────────
  phase = "finishing";
  report(true);
  const pdfStart = performance.now();
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
  timings.pdfMs = performance.now() - pdfStart;
  finished = 1;
  report(true);

  for (const [layer, span] of spans) {
    timings.fetchSpanMs[layer] = Math.round(span.end - span.start);
    timings.requests[layer] = span.n;
  }
  timings.totalMs = performance.now() - t0;
  return {
    pdf,
    timings,
    pixels: pixelsOut
      ? {
          width: nativeW,
          height: nativeH,
          data: pixelsOut.buffer as ArrayBuffer,
        }
      : undefined,
  };
}
