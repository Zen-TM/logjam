import path from "path";
import {
  createCanvas,
  loadImage,
  registerFont,
  type Canvas,
  type CanvasRenderingContext2D,
  type Image,
} from "canvas";
import PDFDocument from "pdfkit";
import type {
  GeoPdfConfig,
  VectorStyleSettings,
  OsmFeatureStyle,
  OsmPointFeatureKey,
} from "@logjam/shared";
import {
  getPaperDimensions,
  GEOPDF_PADDING_MM,
  gridConvergence,
  toEastingNorthing,
  fromEastingNorthing,
  detectMgaZone,
  GEOPDF_BASE_LAYER_CONFIG,
  overlayAttributionLines,
  OSM_POINT_FEATURE_KEYS,
  OSM_POINT_ICON,
  iconTargetPx,
  rgbaCssFromHex,
  contourWidthStops,
  featureLineWidthStops,
  lerpZoom,
} from "@logjam/shared";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { s3 as s3Client } from "./awsClients";
import { PMTiles } from "pmtiles";
import type { Source } from "pmtiles";
import { VectorTileFeature } from "@mapbox/vector-tile";
import { decodeVectorTileLayer } from "./geoPdfVectorTile";
import {
  TILE_SIZE,
  TARGET_DPI,
  latToMercY,
  computeZoom,
  computeTileToMapTransform,
  type TileCoord,
  type TileToMapTransform,
} from "./geoPdfTileMath";
import { TOPO_LAYERS } from "../constants/topoLayers";
import type { TopoLayerName } from "../constants/topoLayers";
import { AppError } from "../middleware/errorHandler";
import prisma from "./prisma";
import { logger, redactTilePathPatterns } from "../lib/logger";

/** Bounding box of a GeoJSON Polygon/MultiPolygon coords ring. */
function geomBbox(
  geom: { type: string; coordinates: unknown },
): { west: number; south: number; east: number; north: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (pt: number[]) => {
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  };
  const walkRings = (rings: number[][][]) => rings.forEach((r) => r.forEach(visit));
  if (geom.type === "Polygon") {
    walkRings(geom.coordinates as number[][][]);
  } else if (geom.type === "MultiPolygon") {
    (geom.coordinates as number[][][][]).forEach(walkRings);
  } else {
    return null;
  }
  if (!Number.isFinite(minX)) return null;
  return { west: minX, south: minY, east: maxX, north: maxY };
}

// geomagnetism has no type declarations
// eslint-disable-next-line @typescript-eslint/no-var-requires
const geomagnetism = require("geomagnetism");

// ── Constants ────────────────────────────────────────────────────────────────

const MM_PER_INCH = 25.4;
// CSS reference DPI the MapLibre overlay styles are authored against. Used to
// translate the print scale into the display zoom MapLibre would show it at, and
// to scale CSS-pixel style values (font/line/dash) up to the print canvas.
const STYLE_DPI = 96;
const CONCURRENCY = 8;
const LINE_LABEL_MIN_DISTANCE = 450; // px — min spacing between named line-feature labels (tracks, rivers, ...)
const CONTOUR_LABEL_MIN_DISTANCE = 450; // px — 3x sparser than before; contour-only

const SCALE_BAR_DISTANCES = [100, 250, 500, 1000, 2000, 5000, 10000];
const DEG_TO_RAD = Math.PI / 180;

// Point-feature icon PNGs, bundled under api/assets/topo-icons (Dockerfile COPY).
// __dirname resolves to api/src/services in dev and /app/dist/services in prod;
// "../../assets" therefore lands on api/assets and /app/assets respectively.
const ICON_DIR = path.resolve(__dirname, "../../assets/topo-icons");

// ── Embedded overlay font ────────────────────────────────────────────────────
// Source Sans 3 (SIL OFL), bundled under api/assets/fonts (Dockerfile COPY).
// Registered at module load so every canvas context created below resolves the
// "Logjam Map" family. node-canvas needs TTF/OTF (not woff2). Two static weights
// share one family so the `bold ...` font strings keep working.
const FONT_DIR = path.resolve(__dirname, "../../assets/fonts");
// node-canvas (cairo/fontconfig) ignores a custom `family` override and keys the
// face by the font file's own family name, so register under the real name and
// reference it (quoted, since it contains spaces) in every `ctx.font` string.
registerFont(path.join(FONT_DIR, "SourceSans3-Regular.ttf"), {
  family: "Source Sans 3",
  weight: "normal",
});
registerFont(path.join(FONT_DIR, "SourceSans3-SemiBold.ttf"), {
  family: "Source Sans 3",
  weight: "bold",
});
const MAP_FONT = '"Source Sans 3"';

// ── Fixed cartographic palette ───────────────────────────────────────────────
// Theme-independent ink palette for all overlay text/lines/panels. Chosen for
// legibility over busy topo basemaps, not app-theme cohesion (deliberate).
const INK = "#22271f"; // primary text / bars — warm charcoal
const INK_MUTED = "rgba(40, 44, 38, 0.78)"; // grid lines, attribution
const PAPER_FILL = "rgba(250, 247, 240, 0.80)"; // soft-card panel fill (warm cream)
const HAIRLINE = "rgba(70, 64, 52, 0.45)"; // panel border, ticks
const ACCENT = "#9C5A2E"; // sparse flourishes (iron-oxide brown)
// Desaturated compass-arm hint tones (still TN-red / GN-blue / MN-green family).
const TN_COLOR = "#a23b34"; // true north — muted brick red
const GN_COLOR = "#3f5d7a"; // grid north — muted slate blue
const MN_COLOR = "#3f6b46"; // magnetic north — muted forest green

/**
 * Pre-load the PNG icons for every enabled point category into a synchronously
 * accessible cache. Must happen before the (sync) per-feature render loop since
 * `loadImage` is async. Failures are logged and skipped (icon simply omitted).
 */
async function loadPointIcons(
  vectorStyle: VectorStyleSettings,
): Promise<Map<OsmPointFeatureKey, Image>> {
  const cache = new Map<OsmPointFeatureKey, Image>();
  await Promise.all(
    OSM_POINT_FEATURE_KEYS.filter((k) => vectorStyle.features[k]?.enabled).map(
      async (key) => {
        try {
          const img = await loadImage(path.join(ICON_DIR, OSM_POINT_ICON[key].file));
          cache.set(key, img);
        } catch (e) {
          logger.warn(
            { icon: key, err: e instanceof Error ? e.message : String(e) },
            "GeoPDF: failed to load icon",
          );
        }
      },
    ),
  );
  return cache;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / MM_PER_INCH);
}

/** Points (PDF coordinate unit, 72 per inch) */
function mmToPt(mm: number): number {
  return (mm * 72) / MM_PER_INCH;
}

// MIN_ZOOM, computeZoom and TARGET_DPI now live in the pure, unit-tested
// ./geoPdfTileMath module (imported above) — also used by the GeoPDF runtime
// estimator (lib/runtimeEstimates.ts) via geoPdfNativeMegapixels.

/**
 * The display zoom MapLibre would render this print scale at on a 96-DPI screen.
 * Unlike `computeZoom` (a tile-resolution zoom inflated by the 300-DPI print
 * target), this is the zoom that drives style *visibility* and interpolation, so
 * contour/label/point gating in the PDF matches the live overlay. Returned as an
 * unclamped float — gating needs values below the z14 threshold.
 */
function displayZoomForScale(scale: number, latDeg: number): number {
  const cosLat = Math.cos(Math.abs(latDeg) * DEG_TO_RAD);
  return Math.log2((156543.03 * cosLat * STYLE_DPI) / (scale * 0.0254));
}

/** Simple concurrency limiter */
async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/** Format distance label for scale bar */
function formatDistance(m: number): string {
  if (m >= 1000) return `${m / 1000} km`;
  return `${m} m`;
}

// ── Tile transform helpers ──────────────────────────────────────────────────
// TileCoord, TileToMapTransform and computeTileToMapTransform now live in the
// pure, unit-tested ./geoPdfTileMath module (imported above).

/** Buffered label (contour elevation or feature name) — drawn after all overlay
 * lines to keep labels on top. `text` may contain "\n" for stacked lines. */
type PendingLabel = {
  x: number;
  y: number;
  angle: number;
  text: string;
  fontSize: number;
  /** Halo stroke width in canvas px (MapLibre text-halo-width × pxScale). */
  haloWidth: number;
  color: string;
};

/**
 * Project a lat/lon point onto the Mercator-Y canvas used for rendering.
 * Matches the Y axis of computeTileToMapTransform exactly.
 */
function latLonToCanvasPx(
  lat: number,
  lon: number,
  extent: { north: number; south: number; east: number; west: number },
  widthPx: number,
  heightPx: number,
): { x: number; y: number } {
  const x = ((lon - extent.west) / (extent.east - extent.west)) * widthPx;
  const mY_north = latToMercY(extent.north);
  const mY_south = latToMercY(extent.south);
  const mY_pt = latToMercY(lat);
  const y = ((mY_north - mY_pt) / (mY_north - mY_south)) * heightPx;
  return { x, y };
}

// ── Main generation pipeline ─────────────────────────────────────────────────

export async function generateGeoPdf(
  config: GeoPdfConfig,
  userId: string,
  vectorStyle: VectorStyleSettings,
): Promise<Buffer> {
  // 1. Paper dimensions (in mm and pt only — canvas will be native tile resolution)
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
    lockMode: "scale",
    pivot: "mc",
  });
  const widthPt = mmToPt(paper.w);
  const heightPt = mmToPt(paper.h);

  // 1b. Map area (page minus 1cm padding on all sides), in mm and pt only
  const paddingPt = mmToPt(GEOPDF_PADDING_MM);
  const mapWidthMm = paper.w - 2 * GEOPDF_PADDING_MM;
  const mapHeightMm = paper.h - 2 * GEOPDF_PADDING_MM;
  const mapWidthPt = mmToPt(mapWidthMm);
  const mapHeightPt = mmToPt(mapHeightMm);

  // 2. Zoom level & extent
  const { north, south, east, west } = config.extent;
  const centreLat = (north + south) / 2;

  // Resolve base-layer config (URL template, max native zoom, attribution)
  const baseLayerCfg = GEOPDF_BASE_LAYER_CONFIG[config.baseLayer];
  const maxNativeZoom = baseLayerCfg?.maxNativeZoom ?? 18;

  // TARGET_DPI (300) is the reference for zoom selection — this sets how many
  // source pixels per mm we aim for, which determines the tile zoom level.
  const zoom = computeZoom(config.scale, centreLat, TARGET_DPI, maxNativeZoom);

  // Display zoom equivalent of the print scale — drives vector overlay style
  // visibility/interpolation so the export matches the live MapLibre overlay
  // (the 300-DPI `zoom` above sits ~1.6 levels higher and must not gate styles).
  const styleZoom = displayZoomForScale(config.scale, centreLat);

  // 3. Compute the tile transform at zoom=1 scale so we know the native source size.
  const { north: extNorth, south: extSouth, east: extEast, west: extWest } = config.extent;
  const probeTransform = computeTileToMapTransform(
    zoom,
    extNorth,
    extSouth,
    extEast,
    extWest,
    1, // dummy — we just want srcW/srcH
    1,
  );

  const nativeW = Math.round(probeTransform.srcW);
  const nativeH = Math.round(probeTransform.srcH);

  // 4. Memory budget guard (400 MB max for the map canvas)
  const mapCanvasBytes = nativeW * nativeH * 4;
  const MAX_CANVAS_BYTES = 400 * 1024 * 1024;
  if (mapCanvasBytes > MAX_CANVAS_BYTES) {
    throw new AppError(
      400,
      "Requested export is too large. Try a smaller paper size or lower scale.",
    );
  }

  // 5. Allocate canvas at native tile resolution (scaleX = scaleY = 1).
  //    All element sizing uses elementDpi so labels/bars scale correctly.
  const mapCanvas = createCanvas(nativeW, nativeH);
  const mapCtx = mapCanvas.getContext("2d");
  mapCtx.imageSmoothingEnabled = true;
  // imageSmoothingQuality is a valid DOM property but absent from node-canvas's
  // type defs; scope the cast to this property rather than widening to `any`.
  (mapCtx as typeof mapCtx & { imageSmoothingQuality: string }).imageSmoothingQuality = "high";

  // Element DPI: how many pixels per inch at native canvas size
  const elementDpi = (nativeW / mapWidthMm) * MM_PER_INCH;

  // Scale factor from MapLibre CSS pixels (96-DPI reference) to output-canvas
  // pixels. Derived from the *actual* canvas DPI so physical sizes match the
  // overlay regardless of `computeZoom`'s ceil rounding.
  const vectorPxScale = elementDpi / STYLE_DPI;

  // Shared tile transform with scale = 1 (canvas IS the tile pixel grid)
  const transform = computeTileToMapTransform(
    zoom,
    north,
    south,
    east,
    west,
    nativeW,
    nativeH,
  );

  // 6. Base layer — fetch tiles and draw directly onto mapCanvas
  if (baseLayerCfg) {
    await fetchAndDrawHttpTilesDirect(
      mapCtx,
      transform.tiles,
      baseLayerCfg.urlTemplate,
      transform,
    );
  }

  // 7. Overlay tiles from PMTiles archives in S3
  // Track which overlay layers actually painted data onto this map (a layer is
  // only "rendered" if at least one overlapping completed job carried its tiles).
  // Drives the attribution credits so we never credit a source whose data isn't
  // on the page (e.g. a layer selected over an area with no LiDAR coverage).
  const renderedOverlays = new Set<string>();
  if (config.overlays.length > 0) {
    const topoBucket = process.env.S3_BUCKET_TOPO ?? "logjam-topo-jobs";
    const s3 = s3Client;

    // Overlays are always sampled at their native resolution (max z18), independent
    // of the base layer cap. A separate transform maps higher-zoom overlay tiles
    // onto the same canvas dimensions.
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

    // Sort by canonical TOPO_LAYERS index so hillshade is always at the
    // bottom and vector layers (contours, features) are always on top, regardless
    // of the order the user selected them.
    const canonicalOrder: string[] = TOPO_LAYERS.map((l) => l.name);
    const sortedOverlays = [...config.overlays].sort(
      (a, b) => canonicalOrder.indexOf(a) - canonicalOrder.indexOf(b),
    );

    // Look up the user's completed topo jobs and filter to those whose
    // footprint bbox overlaps the export extent. Older jobs render first so
    // newer ones land on top. Jobs without a stored footprint fall through
    // defensively (rendered into every export).
    const completedJobs = await prisma.topoJob.findMany({
      where: { userId, status: "complete" },
      orderBy: { createdAt: "asc" },
      select: { id: true, footprint: true },
    });
    const overlappingJobs = completedJobs.filter((j) => {
      if (!j.footprint) return true;
      const bb = geomBbox(j.footprint as { type: string; coordinates: unknown });
      if (!bb) return true;
      return (
        bb.east > config.extent.west &&
        bb.west < config.extent.east &&
        bb.north > config.extent.south &&
        bb.south < config.extent.north
      );
    });

    // Labels are buffered during line rendering and flushed after all overlays so
    // they always appear on top of every line.
    const pendingLabels: PendingLabel[] = [];
    const placedLabelPositions: Array<{ x: number; y: number }> = [];

    // Point-feature icons must be loaded before the sync per-feature render loop.
    const iconCache = config.overlays.includes("features")
      ? await loadPointIcons(vectorStyle)
      : new Map<OsmPointFeatureKey, Image>();

    for (const overlayName of sortedOverlays as TopoLayerName[]) {
      const layerDef = TOPO_LAYERS.find((l) => l.name === overlayName);
      if (!layerDef) continue;
      for (const job of overlappingJobs) {
        const pmtilesKey = `outputs/${job.id}/${overlayName}.pmtiles`;
        const source = new S3Source(topoBucket, pmtilesKey, s3);
        const archive = new PMTiles(source);
        try {
          let drew = 0;
          if (layerDef.format === "vector") {
            drew = await fetchAndDrawPMTilesVectorDirect(
              mapCtx,
              overlayTransform.tiles,
              archive,
              overlayTransform,
              overlayName,
              styleZoom,
              vectorPxScale,
              vectorStyle,
              iconCache,
              placedLabelPositions,
              pendingLabels,
            );
          } else {
            drew = await fetchAndDrawPMTilesRasterDirect(
              mapCtx,
              overlayTransform.tiles,
              archive,
              overlayTransform,
            );
          }
          if (drew > 0) renderedOverlays.add(overlayName);
        } catch (e) {
          // A job may legitimately lack a given layer (e.g. Mode-A jobs skip
          // vegetation). Treat S3 404 / PMTiles errors as "this job doesn't
          // contribute this overlay" and continue.
          logger.warn(
            {
              overlay: overlayName,
              jobId: job.id,
              err: redactTilePathPatterns(
                e instanceof Error ? e.message : String(e),
              ),
            },
            "GeoPDF: skipping overlay for job",
          );
        }
      }
    }

    // Flush buffered contour labels on top of all overlay lines
    flushPendingLabels(mapCtx, pendingLabels);
  }

  // 7b. Canyon markers
  if (config.canyonMarkers && config.canyonMarkers.length > 0) {
    drawCanyonMarkers(mapCtx, config, nativeW, nativeH, elementDpi);
  }

  // 8. Draw map elements
  if (config.elements.gridLines) {
    drawGridLines(mapCtx, config, nativeW, nativeH, elementDpi);
  }

  // Bottom-left element stack
  const elementMargin = mmToPx(5, elementDpi);
  const elementPadH = mmToPx(2, elementDpi);
  const elementPadV = mmToPx(1.5, elementDpi);
  let stackY = nativeH - elementMargin;

  if (config.elements.scaleBar) {
    stackY = drawScaleBar(
      mapCtx,
      config,
      nativeW,
      stackY,
      elementMargin,
      elementPadH,
      elementPadV,
      elementDpi,
    );
  }

  if (config.elements.scaleText) {
    stackY = drawScaleText(
      mapCtx,
      config,
      stackY,
      elementMargin,
      elementPadH,
      elementPadV,
      elementDpi,
    );
  }

  if (config.elements.compass) {
    stackY = drawCompass(mapCtx, config, stackY, elementMargin, elementDpi);
  }

  if (config.elements.title) {
    drawTitle(
      mapCtx,
      config.elements.title,
      elementMargin,
      elementPadH,
      elementPadV,
      elementDpi,
    );
  }

  // Attribution bottom-right — credit only layers that actually painted data.
  drawAttribution(
    mapCtx,
    nativeW,
    nativeH,
    elementMargin,
    elementDpi,
    config,
    Array.from(renderedOverlays),
  );

  // 9. Build PDF with GeoPDF georeferencing metadata
  const pdfBuffer = await buildPdf(
    mapCanvas,
    widthPt,
    heightPt,
    mapWidthPt,
    mapHeightPt,
    paddingPt,
    config,
  );

  return pdfBuffer;
}

// ── HTTP tile fetching (SIX Maps, etc.) ─────────────────────────────────────

/**
 * Fetch with one retry on transient failure. Tile CDNs occasionally return
 * 5xx / 429 / drop connections; a single retry with short backoff turns a
 * grey square into a successful tile in the common case.
 */
async function fetchTileWithRetry(url: string, timeoutMs: number): Promise<Response> {
  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timeoutId);
    }
  };
  const isRetryable = (res: Response | null, err: unknown): boolean => {
    if (err) return true; // network error / abort
    if (!res) return true;
    return res.status >= 500 || res.status === 429;
  };
  try {
    const res = await attempt();
    if (!isRetryable(res, null)) return res;
    await new Promise((r) => setTimeout(r, 250));
    return await attempt();
  } catch (err) {
    if (!isRetryable(null, err)) throw err;
    await new Promise((r) => setTimeout(r, 250));
    return await attempt();
  }
}

/** Fetch tiles from an HTTP tile server and draw directly onto the output canvas */
async function fetchAndDrawHttpTilesDirect(
  mapCtx: CanvasRenderingContext2D,
  tiles: TileCoord[],
  urlTemplate: string,
  transform: TileToMapTransform,
): Promise<void> {
  await pMap(
    tiles,
    async (tile) => {
      const url = urlTemplate
        .replace("{z}", String(tile.z))
        .replace("{y}", String(tile.y))
        .replace("{x}", String(tile.x));

      // Snap to integer pixel edges so adjacent tiles share a boundary (no seams)
      const rawX =
        ((tile.x - transform.minTileX) * TILE_SIZE - transform.offsetX) *
        transform.scaleX;
      const rawY =
        ((tile.y - transform.minTileY) * TILE_SIZE - transform.offsetY) *
        transform.scaleY;
      const dx0 = Math.floor(rawX);
      const dy0 = Math.floor(rawY);
      const dx1 = Math.ceil(rawX + TILE_SIZE * transform.scaleX);
      const dy1 = Math.ceil(rawY + TILE_SIZE * transform.scaleY);

      try {
        const response = await fetchTileWithRetry(url, 30_000);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuf = await response.arrayBuffer();
        const img = await loadImage(Buffer.from(arrayBuf));
        mapCtx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE, dx0, dy0, dx1 - dx0, dy1 - dy0);
      } catch (err) {
        mapCtx.fillStyle = "#e8e8e8";
        mapCtx.fillRect(dx0, dy0, dx1 - dx0, dy1 - dy0);
        // Privacy: never log tile x/y — at these zooms a tile index is an
        // approximate coordinate of the export AOI (SEC-002).
        logger.warn(
          { source: "http-tile", z: tile.z, err: redactTilePathPatterns(String(err)) },
          "GeoPDF: failed to fetch base-layer tile",
        );
      }
    },
    CONCURRENCY,
  );
}

// ── PMTiles overlay rendering ────────────────────────────────────────────────

class S3Source implements Source {
  constructor(
    private bucket: string,
    private key: string,
    private s3: S3Client,
  ) {}
  async getBytes(
    offset: number,
    length: number,
  ): Promise<{ data: ArrayBuffer }> {
    const resp = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
        Range: `bytes=${offset}-${offset + length - 1}`,
      }),
    );
    const bytes = await resp.Body!.transformToByteArray();
    return { data: bytes.buffer as ArrayBuffer };
  }
  getKey() {
    return `s3://${this.bucket}/${this.key}`;
  }
}

/**
 * Fetch raster PMTiles and draw directly onto the output canvas. Returns the
 * number of tiles that actually painted data (0 = this layer contributed nothing
 * to the map, so it must not be credited in the attribution block).
 */
async function fetchAndDrawPMTilesRasterDirect(
  mapCtx: CanvasRenderingContext2D,
  tiles: TileCoord[],
  archive: PMTiles,
  transform: TileToMapTransform,
): Promise<number> {
  const drawn = await pMap(
    tiles,
    async (tile) => {
      try {
        const result = await archive.getZxy(tile.z, tile.x, tile.y);
        if (!result?.data) return 0;
        const img = await loadImage(Buffer.from(result.data));

        const rawX =
          ((tile.x - transform.minTileX) * TILE_SIZE - transform.offsetX) *
          transform.scaleX;
        const rawY =
          ((tile.y - transform.minTileY) * TILE_SIZE - transform.offsetY) *
          transform.scaleY;
        const dx0 = Math.floor(rawX);
        const dy0 = Math.floor(rawY);
        const dx1 = Math.ceil(rawX + TILE_SIZE * transform.scaleX);
        const dy1 = Math.ceil(rawY + TILE_SIZE * transform.scaleY);

        mapCtx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE, dx0, dy0, dx1 - dx0, dy1 - dy0);
        return 1;
      } catch (err) {
        logger.warn(
          { source: "raster-pmtile", z: tile.z, err: redactTilePathPatterns(String(err)) },
          "GeoPDF: failed to fetch raster PMTile",
        );
        return 0;
      }
    },
    CONCURRENCY,
  );
  return drawn.reduce<number>((a, b) => a + b, 0);
}

/**
 * Fetch vector PMTiles and render features directly onto the output canvas.
 * Returns the number of tiles whose source layer was present (0 = this layer
 * contributed nothing, so it must not be credited in the attribution block).
 */
async function fetchAndDrawPMTilesVectorDirect(
  mapCtx: CanvasRenderingContext2D,
  tiles: TileCoord[],
  archive: PMTiles,
  transform: TileToMapTransform,
  layerName: string,
  styleZoom: number,
  pxScale: number,
  vectorStyle: VectorStyleSettings,
  iconCache: Map<OsmPointFeatureKey, Image>,
  placedLabels: Array<{ x: number; y: number }> = [],
  pendingLabels: PendingLabel[] = [],
): Promise<number> {
  const drawn = await pMap(
    tiles,
    async (tile) => {
      try {
        const result = await archive.getZxy(tile.z, tile.x, tile.y);
        if (!result?.data) return 0;
        const { present, features } = decodeVectorTileLayer(
          result.data,
          layerName,
        );
        const tileDx =
          ((tile.x - transform.minTileX) * TILE_SIZE - transform.offsetX) *
          transform.scaleX;
        const tileDy =
          ((tile.y - transform.minTileY) * TILE_SIZE - transform.offsetY) *
          transform.scaleY;
        if (!present) return 0;
        for (const feature of features) {
          renderVectorFeature(
            mapCtx,
            feature,
            tileDx,
            tileDy,
            styleZoom,
            pxScale,
            layerName,
            transform.scaleX,
            transform.scaleY,
            vectorStyle,
            iconCache,
            placedLabels,
            pendingLabels,
          );
        }
        return 1;
      } catch (err) {
        logger.warn(
          { source: "vector-pmtile", z: tile.z, err: redactTilePathPatterns(String(err)) },
          "GeoPDF: failed to render vector PMTile",
        );
        return 0;
      }
    },
    CONCURRENCY,
  );
  return drawn.reduce<number>((a, b) => a + b, 0);
}

/** Draw all buffered contour labels — called after all overlay lines are rendered */
function flushPendingLabels(
  ctx: CanvasRenderingContext2D,
  labels: PendingLabel[],
): void {
  for (const lbl of labels) {
    ctx.save();
    ctx.translate(lbl.x, lbl.y);
    ctx.rotate(lbl.angle);
    ctx.font = `bold ${lbl.fontSize}px ${MAP_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = lbl.text.split("\n");
    const lineHeight = lbl.fontSize * 1.2;
    const startY = -((lines.length - 1) / 2) * lineHeight;
    for (let i = 0; i < lines.length; i++) {
      const y = startY + i * lineHeight;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = lbl.haloWidth;
      ctx.strokeText(lines[i], 0, y);
      ctx.fillStyle = lbl.color;
      ctx.fillText(lines[i], 0, y);
    }
    ctx.restore();
  }
}

/** Linear interpolation between two zoom stops */
function interpZoom(
  z: number,
  z1: number,
  v1: number,
  z2: number,
  v2: number,
): number {
  const t = Math.max(0, Math.min(1, (z - z1) / (z2 - z1)));
  return v1 + t * (v2 - v1);
}

// Label font size in canvas px: the 9px@z14→12px@z18 ramp scaled by the user's
// global labelScale (default 1) and the device-pixel scale. GeoPDF keeps the
// bare ramp — the print pxScale already enlarges it — and so deliberately
// diverges from the live map (1.75× base) and the MBTiles baker (3× base), which
// bump the base independently of labelScale. No longer a shared-size invariant.
function labelFontSize(styleZoom: number, pxScale: number, labelScale: number): number {
  return interpZoom(styleZoom, 14, 9, 18, 12) * labelScale * pxScale;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderVectorFeature(
  ctx: CanvasRenderingContext2D,
  feature: VectorTileFeature,
  dx: number,
  dy: number,
  styleZoom: number,
  pxScale: number,
  layerName: string,
  transformScaleX = 1,
  transformScaleY = 1,
  vectorStyle: VectorStyleSettings,
  iconCache: Map<OsmPointFeatureKey, Image>,
  placedLabels: Array<{ x: number; y: number }> = [],
  pendingLabels: PendingLabel[] = [],
) {
  const baseScale = TILE_SIZE / feature.extent;
  const scaleX = baseScale * transformScaleX;
  const scaleY = baseScale * transformScaleY;
  const geomType = feature.type; // 1=Point, 2=LineString, 3=Polygon
  const props = feature.properties;

  if (layerName === "contours") {
    renderContourFeature(
      ctx,
      feature,
      dx,
      dy,
      styleZoom,
      pxScale,
      scaleX,
      scaleY,
      geomType,
      props,
      vectorStyle,
      placedLabels,
      pendingLabels,
    );
  } else if (layerName === "features") {
    renderOsmFeature(
      ctx,
      feature,
      dx,
      dy,
      styleZoom,
      pxScale,
      scaleX,
      scaleY,
      geomType,
      props,
      vectorStyle,
      iconCache,
      placedLabels,
      pendingLabels,
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderContourFeature(
  ctx: CanvasRenderingContext2D,
  feature: VectorTileFeature,
  dx: number,
  dy: number,
  styleZoom: number,
  pxScale: number,
  scaleX: number,
  scaleY: number,
  geomType: number,
  props: Record<string, unknown>,
  vectorStyle: VectorStyleSettings,
  placedLabels: Array<{ x: number; y: number }> = [],
  pendingLabels: PendingLabel[] = [],
) {
  if (geomType !== 2) return; // contours are lines
  const elev = Number(props.elev ?? 0);
  const isMajor = elev % 50 === 0;

  // Minor contours only visible at z14+ (matches the live overlay's minzoom).
  // Major contours have no minzoom in the overlay, so they always render.
  if (!isMajor && styleZoom < 14) return;

  // Colour + width come from the user's live vector style, evaluated at the
  // display zoom with the same stops the MapLibre overlay uses, then scaled from
  // CSS pixels to canvas pixels.
  const cs = vectorStyle.contours;
  const stops = contourWidthStops(isMajor ? cs.majorWidthM : cs.minorWidthM);
  const lineWidth = lerpZoom(styleZoom, stops.z12, stops.z18) * pxScale;
  const color = rgbaCssFromHex(isMajor ? cs.majorColour : cs.minorColour);
  const labelColor = rgbaCssFromHex(cs.majorColour);

  const geometry = feature.loadGeometry();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([]);

  for (const ring of geometry) {
    ctx.beginPath();
    for (let j = 0; j < ring.length; j++) {
      const px = dx + ring[j].x * scaleX;
      const py = dy + ring[j].y * scaleY;
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Buffer elevation label on major contours at z14+ — drawn after all lines
    if (isMajor && styleZoom >= 14 && ring.length >= 2) {
      const mid = Math.floor(ring.length / 2);
      const mx = dx + ring[mid].x * scaleX;
      const my = dy + ring[mid].y * scaleY;

      // Skip if too close to an already-placed label
      if (placedLabels.some((p) => Math.hypot(p.x - mx, p.y - my) < CONTOUR_LABEL_MIN_DISTANCE)) continue;
      placedLabels.push({ x: mx, y: my });

      // Calculate angle from adjacent points for text rotation
      const prev = mid > 0 ? mid - 1 : 0;
      const next = mid < ring.length - 1 ? mid + 1 : ring.length - 1;
      const ax = (ring[next].x - ring[prev].x) * scaleX;
      const ay = (ring[next].y - ring[prev].y) * scaleY;
      let angle = Math.atan2(ay, ax);
      // Keep text upright
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;

      pendingLabels.push({
        x: mx,
        y: my,
        angle,
        text: `${elev}m`,
        fontSize: labelFontSize(styleZoom, pxScale, vectorStyle.labelScale ?? 1),
        haloWidth: 1.5 * pxScale,
        color: labelColor,
      });
    }
  }
}

const POINT_KEY_SET = new Set<string>(OSM_POINT_FEATURE_KEYS);

/** Buffer a name label at the midpoint of the longest ring of a line feature. */
function bufferLineLabel(
  geometry: { x: number; y: number }[][],
  dx: number,
  dy: number,
  scaleX: number,
  scaleY: number,
  styleZoom: number,
  pxScale: number,
  text: string,
  color: string,
  placedLabels: Array<{ x: number; y: number }>,
  pendingLabels: PendingLabel[],
  labelScale: number,
) {
  if (styleZoom < 14 || !text) return;
  let ring: { x: number; y: number }[] | null = null;
  for (const r of geometry) if (!ring || r.length > ring.length) ring = r;
  if (!ring || ring.length < 2) return;
  const mid = Math.floor(ring.length / 2);
  const mx = dx + ring[mid].x * scaleX;
  const my = dy + ring[mid].y * scaleY;
  if (placedLabels.some((p) => Math.hypot(p.x - mx, p.y - my) < LINE_LABEL_MIN_DISTANCE)) return;
  placedLabels.push({ x: mx, y: my });
  const prev = mid > 0 ? mid - 1 : 0;
  const next = mid < ring.length - 1 ? mid + 1 : ring.length - 1;
  const ax = (ring[next].x - ring[prev].x) * scaleX;
  const ay = (ring[next].y - ring[prev].y) * scaleY;
  let angle = Math.atan2(ay, ax);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  pendingLabels.push({
    x: mx,
    y: my,
    angle,
    text,
    fontSize: labelFontSize(styleZoom, pxScale, labelScale),
    haloWidth: 1.5 * pxScale,
    color,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderOsmFeature(
  ctx: CanvasRenderingContext2D,
  feature: VectorTileFeature,
  dx: number,
  dy: number,
  styleZoom: number,
  pxScale: number,
  scaleX: number,
  scaleY: number,
  geomType: number,
  props: Record<string, unknown>,
  vectorStyle: VectorStyleSettings,
  iconCache: Map<OsmPointFeatureKey, Image>,
  placedLabels: Array<{ x: number; y: number }> = [],
  pendingLabels: PendingLabel[] = [],
) {
  const category = String(props._category ?? "");
  const style = (vectorStyle.features as Record<string, OsmFeatureStyle | undefined>)[category];
  if (!style || !style.enabled) return; // per-category enable mirrors the overlay
  const geometry = feature.loadGeometry();
  const colour = rgbaCssFromHex(style.colour);

  // Point categories → fixed PNG icon (+ optional name label at z14+).
  if (POINT_KEY_SET.has(category)) {
    if (geomType !== 1) return;
    const key = category as OsmPointFeatureKey;
    const minzoom = key === "gate" ? 14 : 12;
    if (styleZoom < minzoom) return;
    const icon = iconCache.get(key);
    const t = iconTargetPx(OSM_POINT_ICON[key].sizeZ18, styleZoom) * pxScale;
    const name = typeof props.name === "string" ? props.name : "";
    for (const ring of geometry) {
      for (const pt of ring) {
        const px = dx + pt.x * scaleX;
        const py = dy + pt.y * scaleY;
        if (icon) ctx.drawImage(icon, px - t / 2, py - t / 2, t, t);
        if (styleZoom >= 14) {
          let text = name;
          if (key === "peak") {
            const ele = props.ele;
            const eleStr =
              ele !== undefined && ele !== null && `${ele}`.trim() !== "" ? `${ele} m` : "";
            text = [name, eleStr].filter(Boolean).join("\n");
          }
          if (text) {
            pendingLabels.push({
              x: px,
              y: py + t / 2 + interpZoom(styleZoom, 14, 7, 18, 9) * pxScale,
              angle: 0,
              text,
              fontSize: labelFontSize(styleZoom, pxScale, vectorStyle.labelScale ?? 1),
              haloWidth: 1.5 * pxScale,
              color: colour,
            });
          }
        }
      }
    }
    return;
  }

  // Line / fill categories.
  switch (category) {
    case "waterway":
    case "road": {
      const s = featureLineWidthStops(style.widthZ18);
      drawLineFeature(ctx, geometry, dx, dy, scaleX, scaleY, {
        color: colour,
        width: lerpZoom(styleZoom, s.z12, s.z18) * pxScale,
      });
      const label =
        category === "road"
          ? (typeof props.name === "string" && props.name) ||
            (typeof props.ref === "string" ? props.ref : "")
          : typeof props.name === "string"
            ? props.name
            : "";
      bufferLineLabel(geometry, dx, dy, scaleX, scaleY, styleZoom, pxScale, label, colour, placedLabels, pendingLabels, vectorStyle.labelScale ?? 1);
      break;
    }
    case "track": {
      const s = featureLineWidthStops(style.widthZ18);
      // MapLibre line-dasharray units are multiples of the line width, so scale
      // the [4,2] pattern by the final canvas width to match the overlay.
      const width = lerpZoom(styleZoom, s.z12, s.z18) * pxScale;
      drawLineFeature(ctx, geometry, dx, dy, scaleX, scaleY, {
        color: colour,
        width,
        dash: [4 * width, 2 * width],
      });
      const label = typeof props.name === "string" ? props.name : "";
      bufferLineLabel(geometry, dx, dy, scaleX, scaleY, styleZoom, pxScale, label, colour, placedLabels, pendingLabels, vectorStyle.labelScale ?? 1);
      break;
    }
    case "power": {
      // Power lines use a constant pixel width (matches the overlay). Dasharray
      // [3,4] is in line-width units → scale by the final canvas width.
      const width = style.widthZ18 * pxScale;
      drawLineFeature(ctx, geometry, dx, dy, scaleX, scaleY, {
        color: colour,
        width,
        dash: [3 * width, 4 * width],
      });
      break;
    }
    case "building":
      if (geomType === 3) {
        drawFillFeature(ctx, geometry, dx, dy, scaleX, scaleY, {
          fill: colour,
          outline: colour,
        });
      }
      break;
    default:
      // Other categories (e.g. bridge) have no live overlay layer — skip to
      // stay consistent with the on-screen map.
      break;
  }
}

function drawLineFeature(
  ctx: CanvasRenderingContext2D,
  geometry: { x: number; y: number }[][],
  dx: number,
  dy: number,
  scaleX: number,
  scaleY: number,
  style: { color: string; width: number; dash?: number[] },
) {
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.setLineDash(style.dash ?? []);
  for (const ring of geometry) {
    ctx.beginPath();
    for (let j = 0; j < ring.length; j++) {
      const px = dx + ring[j].x * scaleX;
      const py = dy + ring[j].y * scaleY;
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawFillFeature(
  ctx: CanvasRenderingContext2D,
  geometry: { x: number; y: number }[][],
  dx: number,
  dy: number,
  scaleX: number,
  scaleY: number,
  style: { fill: string; outline: string },
) {
  for (const ring of geometry) {
    ctx.beginPath();
    for (let j = 0; j < ring.length; j++) {
      const px = dx + ring[j].x * scaleX;
      const py = dy + ring[j].y * scaleY;
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.strokeStyle = style.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// ── Map elements ─────────────────────────────────────────────────────────────

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawElementBackground(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dpi: number,
) {
  const radius = mmToPx(1.2, dpi);

  // Soft drop shadow + warm-paper fill, then a hairline border with no shadow.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
  ctx.shadowBlur = mmToPx(0.9, dpi);
  ctx.shadowOffsetY = mmToPx(0.4, dpi);
  ctx.fillStyle = PAPER_FILL;
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = mmToPx(0.2, dpi);
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.stroke();
  ctx.restore();
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  margin: number,
  padH: number,
  padV: number,
  dpi: number,
) {
  const fontSize = mmToPx(4, dpi);
  ctx.font = `bold ${fontSize}px ${MAP_FONT}`;
  const metrics = ctx.measureText(title);
  const boxW = metrics.width + padH * 2;
  const boxH = fontSize + padV * 2;
  const x = margin;
  const y = margin;

  drawElementBackground(ctx, x, y, boxW, boxH, dpi);
  ctx.fillStyle = INK;
  ctx.fillText(title, x + padH, y + padV + fontSize * 0.85);

  // Thin accent rule under the title.
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = mmToPx(0.5, dpi);
  ctx.beginPath();
  ctx.moveTo(x + padH, y + padV + fontSize + mmToPx(0.6, dpi));
  ctx.lineTo(x + padH + metrics.width, y + padV + fontSize + mmToPx(0.6, dpi));
  ctx.stroke();
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  config: GeoPdfConfig,
  canvasWidth: number,
  stackY: number,
  margin: number,
  padH: number,
  padV: number,
  dpi: number,
): number {
  // Find largest round distance fitting 25% of map width
  const midLat = (config.extent.north + config.extent.south) / 2;
  const mapWidthM =
    (config.extent.east - config.extent.west) *
    111320 *
    Math.cos(midLat * DEG_TO_RAD);
  const maxBarM = mapWidthM * 0.25;
  let barDistM = SCALE_BAR_DISTANCES[0];
  for (const d of SCALE_BAR_DISTANCES) {
    if (d <= maxBarM) barDistM = d;
    else break;
  }

  const barWidthPx = (barDistM / mapWidthM) * canvasWidth;
  const barHeight = mmToPx(2, dpi);
  const fontSize = mmToPx(2.5, dpi);
  const segments = 4;
  const segWidth = barWidthPx / segments;

  const labelText = formatDistance(barDistM);
  ctx.font = `${fontSize}px ${MAP_FONT}`;
  const labelW = ctx.measureText(labelText).width;

  const boxW = barWidthPx + padH * 2 + labelW + mmToPx(2, dpi);
  const boxH = barHeight + fontSize + padV * 3;
  const x = margin;
  const y = stackY - boxH;

  drawElementBackground(ctx, x, y, boxW, boxH, dpi);

  // Draw alternating segments
  for (let i = 0; i < segments; i++) {
    ctx.fillStyle = i % 2 === 0 ? INK : "white";
    ctx.fillRect(x + padH + i * segWidth, y + padV, segWidth, barHeight);
  }

  // Bar border
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + padH, y + padV, barWidthPx, barHeight);

  // Labels
  ctx.fillStyle = INK;
  ctx.font = `${fontSize}px ${MAP_FONT}`;
  ctx.fillText("0", x + padH, y + padV + barHeight + fontSize + mmToPx(0.5, dpi));
  ctx.fillText(
    labelText,
    x + padH + barWidthPx + mmToPx(1, dpi),
    y + padV + barHeight / 2 + fontSize * 0.35,
  );

  return y - mmToPx(1, dpi);
}

function drawScaleText(
  ctx: CanvasRenderingContext2D,
  config: GeoPdfConfig,
  stackY: number,
  margin: number,
  padH: number,
  padV: number,
  dpi: number,
): number {
  const text = `1:${Math.round(config.scale).toLocaleString()}`;
  const fontSize = mmToPx(3, dpi);
  ctx.font = `bold ${fontSize}px ${MAP_FONT}`;
  const metrics = ctx.measureText(text);
  const boxW = metrics.width + padH * 2;
  const boxH = fontSize + padV * 2;
  const x = margin;
  const y = stackY - boxH;

  drawElementBackground(ctx, x, y, boxW, boxH, dpi);
  ctx.fillStyle = INK;
  ctx.fillText(text, x + padH, y + padV + fontSize * 0.85);

  return y - mmToPx(1, dpi);
}

function drawCompass(
  ctx: CanvasRenderingContext2D,
  config: GeoPdfConfig,
  stackY: number,
  margin: number,
  dpi: number,
): number {
  const midLat = (config.extent.north + config.extent.south) / 2;
  const midLon = (config.extent.east + config.extent.west) / 2;

  // Magnetic declination
  const model = geomagnetism.model();
  const magInfo = model.point([midLat, midLon]);
  const magDecl = magInfo.decl as number; // degrees, positive = east

  // Grid convergence
  const gridConv = gridConvergence(midLat, midLon);

  // ── Layout ───────────────────────────────────────────────────────────────
  // Standard declination diagram: three arms from one origin at their TRUE
  // angles (no exaggeration). Arms have distinct lengths (TN longest, GN
  // shortest, MN medium) so the near-coincident TN/GN arms stay distinguishable
  // and their tip labels land at different radii without colliding.
  const armTN = mmToPx(16, dpi);
  const armMN = mmToPx(13, dpi);
  const armGN = mmToPx(10, dpi);
  const headroom = mmToPx(5.5, dpi); // star + TN label above the longest arm
  const topPad = mmToPx(2, dpi);
  const tipFont = mmToPx(2.3, dpi);
  const readoutFont = mmToPx(2.6, dpi);
  const readoutGap = mmToPx(3.5, dpi);
  const rowH = readoutFont * 1.55;
  const bottomPad = mmToPx(3, dpi);
  const readoutInset = mmToPx(4, dpi);
  const sidePad = mmToPx(3.5, dpi);
  const starR = mmToPx(1.7, dpi);
  const barbLen = mmToPx(3, dpi);
  const barbW = mmToPx(1.7, dpi);
  // Tip-label radial offsets beyond each arm tip (shared by sizing + drawing).
  const tnLabelExtra = starR + mmToPx(2.2, dpi);
  const mnLabelExtra = mmToPx(3, dpi);
  const gnLabelExtra = mmToPx(2.6, dpi);

  const fmtDecl = (v: number) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? "E" : "W"}`;

  // ── Dynamic width ──────────────────────────────────────────────────────────
  // The fixed 34 mm box left wide gutters. Size the panel to the wider of two
  // content blocks: the arm/label cluster, and the two-line declination readout.
  // x-offsets below are measured RELATIVE TO THE ARM ORIGIN (positive = right).
  const armX: number[] = [0];
  ctx.font = `bold ${tipFont}px ${MAP_FONT}`;
  const addArm = (deg: number, len: number, labelExtra: number, label: string) => {
    const s = Math.sin(deg * DEG_TO_RAD);
    armX.push(s * len, s * len - starR, s * len + starR); // tip + star/tick spread
    const lw = ctx.measureText(label).width;
    const lcx = s * (len + labelExtra);
    armX.push(lcx - lw / 2, lcx + lw / 2);
  };
  addArm(0, armTN, tnLabelExtra, "TN");
  addArm(magDecl, armMN, mnLabelExtra, "MN");
  addArm(gridConv, armGN, gnLabelExtra, "GN");
  // MN half-arrow barb reaches perpendicular to its arm.
  {
    const r = magDecl * DEG_TO_RAD;
    armX.push(Math.sin(r) * (armMN - barbLen) + Math.cos(r) * barbW);
  }
  const leftHalf = -Math.min(...armX);
  const rightHalf = Math.max(...armX);
  const armBlockWidth = 2 * (Math.max(leftHalf, rightHalf) + sidePad);

  // Readout block: bold abbreviation + regular value, per row; take the widest.
  let readoutRowWidth = 0;
  for (const [abbr, val] of [
    ["MN", fmtDecl(magDecl)],
    ["GN", fmtDecl(gridConv)],
  ] as const) {
    ctx.font = `bold ${readoutFont}px ${MAP_FONT}`;
    const w = ctx.measureText(abbr + "  ").width;
    ctx.font = `${readoutFont}px ${MAP_FONT}`;
    readoutRowWidth = Math.max(readoutRowWidth, w + ctx.measureText(val).width);
  }
  const readoutBlockWidth = readoutInset + readoutRowWidth + mmToPx(2, dpi);

  const arrowAreaH = headroom + armTN;
  const boxW = Math.max(armBlockWidth, readoutBlockWidth, mmToPx(20, dpi));
  const boxH =
    topPad + arrowAreaH + readoutGap + 2 * rowH + bottomPad;
  const boxX = margin;
  const boxY = stackY - boxH;

  drawElementBackground(ctx, boxX, boxY, boxW, boxH, dpi);

  const cx = boxX + boxW / 2;
  const cy = boxY + topPad + arrowAreaH; // arm origin (base), arms point up

  // Bearing (deg, clockwise from up, +ve = east) → screen point at radius `len`.
  const bearingPt = (deg: number, len: number) => {
    const r = deg * DEG_TO_RAD;
    return { x: cx + Math.sin(r) * len, y: cy - Math.cos(r) * len };
  };

  const drawArm = (deg: number, len: number, color: string) => {
    const tip = bearingPt(deg, len);
    ctx.strokeStyle = color;
    ctx.lineWidth = mmToPx(0.45, dpi);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    return tip;
  };

  // Five-point star (points up), filled — marks True North per convention.
  const drawStar = (x: number, y: number, rOuter: number, color: string) => {
    const rInner = rOuter * 0.42;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? rOuter : rInner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  // Single-sided barb (half-arrowhead) at MN tip, per convention.
  const drawHalfArrow = (tip: { x: number; y: number }, deg: number, color: string) => {
    const r = deg * DEG_TO_RAD;
    const dir = { x: Math.sin(r), y: -Math.cos(r) }; // along arm toward tip
    const perp = { x: -dir.y, y: dir.x }; // left of travel
    const base = { x: tip.x - dir.x * barbLen, y: tip.y - dir.y * barbLen };
    const side = { x: base.x + perp.x * barbW, y: base.y + perp.y * barbW };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(base.x, base.y);
    ctx.lineTo(side.x, side.y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  // ── Arms (longest first so shorter arms read on top near the origin) ───────
  const tnTip = drawArm(0, armTN, TN_COLOR);
  const mnTip = drawArm(magDecl, armMN, MN_COLOR);
  const gnTip = drawArm(gridConv, armGN, GN_COLOR);

  // Origin dot
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, cy, mmToPx(0.5, dpi), 0, Math.PI * 2);
  ctx.fill();

  // Tip symbology
  drawStar(tnTip.x, tnTip.y, starR, TN_COLOR);
  drawHalfArrow(mnTip, magDecl, MN_COLOR);
  // GN: short perpendicular tick across the tip
  ctx.strokeStyle = GN_COLOR;
  ctx.lineWidth = mmToPx(0.45, dpi);
  {
    const r = gridConv * DEG_TO_RAD;
    const perp = { x: Math.cos(r), y: Math.sin(r) };
    const t = mmToPx(1, dpi);
    ctx.beginPath();
    ctx.moveTo(gnTip.x - perp.x * t, gnTip.y - perp.y * t);
    ctx.lineTo(gnTip.x + perp.x * t, gnTip.y + perp.y * t);
    ctx.stroke();
  }

  // Tip labels — placed just beyond each tip along its bearing; distinct arm
  // lengths keep them from colliding.
  ctx.font = `bold ${tipFont}px ${MAP_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tnLabel = bearingPt(0, armTN + tnLabelExtra);
  ctx.fillStyle = TN_COLOR;
  ctx.fillText("TN", tnLabel.x, tnLabel.y);
  const mnLabel = bearingPt(magDecl, armMN + mnLabelExtra);
  ctx.fillStyle = MN_COLOR;
  ctx.fillText("MN", mnLabel.x, mnLabel.y);
  const gnLabel = bearingPt(gridConv, armGN + gnLabelExtra);
  ctx.fillStyle = GN_COLOR;
  ctx.fillText("GN", gnLabel.x, gnLabel.y);

  // ── Angle readout (relative to true north, cardinal-suffixed) ──────────────
  const rx = boxX + readoutInset;
  let ry = cy + readoutGap + rowH / 2;
  ctx.textAlign = "start";
  ctx.textBaseline = "middle";
  for (const [color, abbr, val] of [
    [MN_COLOR, "MN", fmtDecl(magDecl)],
    [GN_COLOR, "GN", fmtDecl(gridConv)],
  ] as const) {
    ctx.fillStyle = color;
    ctx.font = `bold ${readoutFont}px ${MAP_FONT}`;
    ctx.fillText(abbr, rx, ry);
    const abbrW = ctx.measureText(abbr + "  ").width;
    ctx.fillStyle = INK;
    ctx.font = `${readoutFont}px ${MAP_FONT}`;
    ctx.fillText(val, rx + abbrW, ry);
    ry += rowH;
  }

  // Reset context state
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";

  return boxY;
}

function drawCanyonMarkers(
  ctx: CanvasRenderingContext2D,
  config: GeoPdfConfig,
  widthPx: number,
  heightPx: number,
  dpi: number,
) {
  const radius = mmToPx(2, dpi);
  const labelFontSize = mmToPx(2.5, dpi);

  for (const marker of config.canyonMarkers!) {
    const { x, y } = latLonToCanvasPx(
      marker.lat,
      marker.lon,
      config.extent,
      widthPx,
      heightPx,
    );

    // Skip markers outside canvas bounds
    if (
      x < -radius ||
      x > widthPx + radius ||
      y < -radius ||
      y > heightPx + radius
    )
      continue;

    // Filled circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = marker.color === "owned" ? "#f97316" : "#3b82f6";
    ctx.fill();
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Name label at scales <= 1:50000
    if (config.scale <= 50000 && marker.name) {
      ctx.font = `${labelFontSize}px ${MAP_FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      const labelX = x + radius + mmToPx(1, dpi);
      const labelY = y;

      // White halo for legibility
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(marker.name, labelX, labelY);

      ctx.fillStyle = INK;
      ctx.fillText(marker.name, labelX, labelY);
    }
  }

  // Reset context state
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

/**
 * Draw an MGA grid label with the principal 2-digit grid reference in a
 * larger bold font, following standard topographic map conventions.
 */
function drawGridLabel(
  ctx: CanvasRenderingContext2D,
  value: number,
  interval: number,
  x: number,
  y: number,
  smallFontSize: number,
  largeFontSize: number,
) {
  const km = Math.round(value / 1000);
  const principal = String(km % 100).padStart(2, "0");
  const prefix = String(Math.floor(km / 100));

  let curX = x;

  ctx.font = `${smallFontSize}px ${MAP_FONT}`;
  ctx.fillText(prefix, curX, y);
  curX += ctx.measureText(prefix).width;

  ctx.font = `bold ${largeFontSize}px ${MAP_FONT}`;
  ctx.fillText(principal, curX, y);
  curX += ctx.measureText(principal).width;

  if (interval < 10000) {
    ctx.font = `${smallFontSize}px ${MAP_FONT}`;
    ctx.fillText("000", curX, y);
  }

  // Restore font
  ctx.font = `${smallFontSize}px ${MAP_FONT}`;
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  config: GeoPdfConfig,
  widthPx: number,
  heightPx: number,
  dpi: number,
) {
  const { north, south, east, west } = config.extent;
  const fontSize = mmToPx(2, dpi);
  const largeFontSize = mmToPx(3.2, dpi);
  ctx.font = `${fontSize}px ${MAP_FONT}`;
  ctx.strokeStyle = INK_MUTED;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2.5;

  if (config.elements.gridLines === "enNorthing") {
    // MGA easting/northing grid
    const interval = config.scale <= 25000 ? 1000 : 10000;

    // Use a single MGA zone based on the map centre to avoid cross-zone issues
    const midLon = (east + west) / 2;
    const zone = detectMgaZone(midLon);

    const swEN = toEastingNorthing(south, west);
    const neEN = toEastingNorthing(north, east);

    const toPixel = (lat: number, lon: number) =>
      latLonToCanvasPx(lat, lon, config.extent, widthPx, heightPx);

    // Vertical lines (constant easting, varying northing)
    const startE = Math.ceil(swEN.easting / interval) * interval;
    const endE = Math.floor(neEN.easting / interval) * interval;
    for (let e = startE; e <= endE; e += interval) {
      const topLL = fromEastingNorthing(e, neEN.northing, zone);
      const botLL = fromEastingNorthing(e, swEN.northing, zone);
      const topPx = toPixel(topLL.lat, topLL.lon);
      const botPx = toPixel(botLL.lat, botLL.lon);
      ctx.beginPath();
      ctx.moveTo(topPx.x, topPx.y);
      ctx.lineTo(botPx.x, botPx.y);
      ctx.stroke();
      drawGridLabel(
        ctx,
        e,
        interval,
        topPx.x + 2,
        largeFontSize + 4,
        fontSize,
        largeFontSize,
      );
    }

    // Horizontal lines (constant northing, varying easting)
    const startN = Math.ceil(swEN.northing / interval) * interval;
    const endN = Math.floor(neEN.northing / interval) * interval;
    for (let n = startN; n <= endN; n += interval) {
      const leftLL = fromEastingNorthing(swEN.easting, n, zone);
      const rightLL = fromEastingNorthing(neEN.easting, n, zone);
      const leftPx = toPixel(leftLL.lat, leftLL.lon);
      const rightPx = toPixel(rightLL.lat, rightLL.lon);
      ctx.beginPath();
      ctx.moveTo(leftPx.x, leftPx.y);
      ctx.lineTo(rightPx.x, rightPx.y);
      ctx.stroke();
      drawGridLabel(ctx, n, interval, 2, leftPx.y - 2, fontSize, largeFontSize);
    }
  } else {
    // Lat/lon grid
    const latRange = north - south;
    const lonRange = east - west;

    // Choose interval based on extent size
    const intervals = [10, 5, 2, 1, 0.5, 1 / 6, 1 / 12, 1 / 60, 1 / 120]; // degrees
    let latInterval = intervals[0];
    for (const iv of intervals) {
      if (latRange / iv >= 3 && latRange / iv <= 15) {
        latInterval = iv;
        break;
      }
    }
    let lonInterval = intervals[0];
    for (const iv of intervals) {
      if (lonRange / iv >= 3 && lonRange / iv <= 15) {
        lonInterval = iv;
        break;
      }
    }

    // Horizontal lines (latitudes)
    const startLat = Math.ceil(south / latInterval) * latInterval;
    for (let lat = startLat; lat <= north; lat += latInterval) {
      const { y } = latLonToCanvasPx(lat, west, config.extent, widthPx, heightPx);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(widthPx, y);
      ctx.stroke();
      ctx.fillText(lat.toFixed(4) + "°", 2, y - 2);
    }

    // Vertical lines (longitudes)
    const startLon = Math.ceil(west / lonInterval) * lonInterval;
    for (let lon = startLon; lon <= east; lon += lonInterval) {
      const frac = (lon - west) / (east - west);
      const x = frac * widthPx;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, heightPx);
      ctx.stroke();
      ctx.fillText(lon.toFixed(4) + "°", x + 2, fontSize + 6);
    }
  }
}

function drawAttribution(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
  margin: number,
  dpi: number,
  config: GeoPdfConfig,
  renderedOverlays: string[],
) {
  const fontSize = mmToPx(1.8, dpi);
  ctx.font = `${fontSize}px ${MAP_FONT}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";

  const baseAttrib =
    GEOPDF_BASE_LAYER_CONFIG[config.baseLayer]?.attribution ??
    "Base map data";

  // Word-wrap each credit to the right ~55% of the map width so the long open-
  // data licence strings never run off the left edge (worst in portrait, where
  // the short paper edge gives a smaller pixel width). The left ~45% stays clear
  // of the bottom-left scale-bar/compass stack, so no collision handling is
  // needed. A single word wider than the budget (e.g. a URL) gets its own line.
  const maxLineWidth = widthPx * 0.55;
  const wrap = (text: string): string[] => {
    const words = text.split(" ");
    const wrapped: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > maxLineWidth) {
        wrapped.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) wrapped.push(current);
    return wrapped;
  };

  // Credit sources stack bottom-up: "Generated by Logjam" pinned to the corner,
  // then the base-map credit, then one line per overlay data source that
  // actually rendered (elevation / vegetation / features) — each open-data
  // licence requires its own attribution, but only where its data is on the
  // page. Build the flat visual line list in top-to-bottom reading order, then
  // draw from the bottom up so wrapped sub-lines keep their reading order.
  const visualLines = [
    baseAttrib,
    ...overlayAttributionLines(renderedOverlays),
  ].flatMap(wrap);
  visualLines.push("Generated by Logjam");

  const lineStep = fontSize + mmToPx(0.5, dpi);
  const x = widthPx - margin;
  // Bottom line has the largest drawing index (0 from the bottom): iterate the
  // visual list in reverse so index counts distance up from the bottom margin.
  for (let i = 0; i < visualLines.length; i++) {
    const line = visualLines[visualLines.length - 1 - i];
    const y = heightPx - margin - lineStep * i;
    // Light paper-cream halo carries legibility over any basemap (incl. dark
    // satellite imagery), so the attribution no longer needs a full panel.
    ctx.save();
    ctx.lineWidth = mmToPx(0.6, dpi);
    ctx.lineJoin = "round";
    ctx.strokeStyle = PAPER_FILL;
    ctx.strokeText(line, x, y);
    ctx.fillStyle = INK;
    ctx.fillText(line, x, y);
    ctx.restore();
  }

  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

// ── PDF assembly with GeoPDF metadata ────────────────────────────────────────

async function buildPdf(
  mapCanvas: Canvas,
  widthPt: number,
  heightPt: number,
  mapWidthPt: number,
  mapHeightPt: number,
  paddingPt: number,
  config: GeoPdfConfig,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [widthPt, heightPt],
      margin: 0,
      info: {
        Title: config.elements.title ?? "Logjam GeoPDF Export",
        Creator: "Logjam",
        Producer: "Logjam GeoPDF Generator",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // White page background
    doc.rect(0, 0, widthPt, heightPt).fill("white");

    // Map image inset by padding on all sides — embed at high resolution (0.95 quality)
    const imgBuffer = mapCanvas.toBuffer("image/jpeg", { quality: 0.95 });
    doc.image(imgBuffer, paddingPt, paddingPt, {
      width: mapWidthPt,
      height: mapHeightPt,
    });

    // GeoPDF georeferencing metadata (PDF 1.7 §8.7.2 / OGC GeoPDF)
    try {
      const { north, south, east, west } = config.extent;

      const wgs84Wkt =
        'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",' +
        'SPHEROID["WGS_1984",6378137,298.257223563]],' +
        'PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';

      const gcsRef = (doc as any).ref({
        Type: "PROJCS",
        WKT: wgs84Wkt,
      });
      gcsRef.end();

      // Normalised page coordinates of the map area (PDF y=0 is bottom of page)
      const lx0 = paddingPt / widthPt;
      const lx1 = (widthPt - paddingPt) / widthPt;
      const ly0 = paddingPt / heightPt;
      const ly1 = (heightPt - paddingPt) / heightPt;

      const measureRef = (doc as any).ref({
        Type: "Measure",
        Subtype: "GEO",
        // GPTS: four corners in lat/lon order — BL, BR, TR, TL
        GPTS: [south, west, south, east, north, east, north, west],
        // LPTS: corresponding normalised page coordinates (0,0 = bottom-left)
        LPTS: [lx0, ly0, lx1, ly0, lx1, ly1, lx0, ly1],
        GCS: gcsRef,
      });
      measureRef.end();

      const viewportRef = (doc as any).ref({
        Type: "Viewport",
        BBox: [paddingPt, paddingPt, widthPt - paddingPt, heightPt - paddingPt],
        Measure: measureRef,
      });
      viewportRef.end();

      // Attach viewport to the current page
      const page = (doc as any)._root.data.Pages.data.Kids[0];
      if (page && page.data) {
        page.data.VP = [viewportRef];
      }
    } catch (err) {
      // GeoPDF metadata is best-effort — PDF renders correctly without it.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "GeoPDF: failed to inject GeoPDF metadata",
      );
    }

    doc.end();
  });
}
