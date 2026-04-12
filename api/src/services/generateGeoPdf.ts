import {
  createCanvas,
  loadImage,
  type Canvas,
  type CanvasRenderingContext2D,
} from "canvas";
import PDFDocument from "pdfkit";
import type { GeoPdfConfig } from "@logjam/shared";
import {
  getPaperDimensions,
  gridConvergence,
  toEastingNorthing,
  fromEastingNorthing,
  detectMgaZone,
} from "@logjam/shared";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { PMTiles } from "pmtiles";
import type { Source } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { MASTER_TOPO_LAYERS } from "../constants/topoLayers";
import { AppError } from "../middleware/errorHandler";

// geomagnetism has no type declarations
// eslint-disable-next-line @typescript-eslint/no-var-requires
const geomagnetism = require("geomagnetism");

// ── Constants ────────────────────────────────────────────────────────────────

const DPI = 150;
const MM_PER_INCH = 25.4;
const TILE_SIZE = 256;
const CONCURRENCY = 8;


const SIX_EXPORT_URLS: Record<string, string> = {
  "six-topo":
    "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Topo_Map/MapServer/export",
  "six-base":
    "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer/export",
  "six-imagery":
    "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/export",
};

const MAX_EXPORT_SIZE = 4096;

const SCALE_BAR_DISTANCES = [100, 250, 500, 1000, 2000, 5000, 10000];
const DEG_TO_RAD = Math.PI / 180;

// ── Helpers ──────────────────────────────────────────────────────────────────

function mmToPx(mm: number): number {
  return Math.round((mm * DPI) / MM_PER_INCH);
}

/** Points (PDF coordinate unit, 72 per inch) */
function mmToPt(mm: number): number {
  return (mm * 72) / MM_PER_INCH;
}

const MAX_ZOOM = 18;
const MIN_ZOOM = 8;

/** Compute the tile zoom level that provides at least 1 source pixel per output pixel */
function computeZoom(scale: number, latDeg: number, dpi: number): number {
  const cosLat = Math.cos(Math.abs(latDeg) * DEG_TO_RAD);
  const z = Math.log2((156543.03 * cosLat * dpi) / (scale * 0.0254));
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.ceil(z)));
}

/** Convert longitude to tile X index at given zoom */
function lon2tileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

/** Convert latitude to tile Y index at given zoom */
function lat2tileY(lat: number, z: number): number {
  const latRad = lat * DEG_TO_RAD;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, z),
  );
}

/** Convert tile X index to longitude (west edge) */
function tileX2lon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

/** Convert tile Y index to latitude (north edge) */
function tileY2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
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

type TileCoord = { x: number; y: number; z: number };

/** Transform mapping tile-grid pixel space to output mapCanvas pixel space */
interface TileToMapTransform {
  minTileX: number;
  minTileY: number;
  tiles: TileCoord[];
  offsetX: number; // pixel offset within tile grid where extent starts
  offsetY: number;
  scaleX: number; // ratio: output pixels / source pixels
  scaleY: number;
}

/** Compute the transform from tile-grid pixel space to output canvas pixel space.
 *  No intermediate canvas is allocated — only the math from the old cropTileCanvas. */
function computeTileToMapTransform(
  zoom: number,
  north: number,
  south: number,
  east: number,
  west: number,
  widthPx: number,
  heightPx: number,
): TileToMapTransform {
  const minTileX = lon2tileX(west, zoom);
  const maxTileX = lon2tileX(east, zoom);
  const minTileY = lat2tileY(north, zoom);
  const maxTileY = lat2tileY(south, zoom);

  const tiles: TileCoord[] = [];
  for (let y = minTileY; y <= maxTileY; y++) {
    for (let x = minTileX; x <= maxTileX; x++) {
      tiles.push({ x, y, z: zoom });
    }
  }

  const tileGridW = (maxTileX - minTileX + 1) * TILE_SIZE;
  const tileGridH = (maxTileY - minTileY + 1) * TILE_SIZE;

  const tileOriginLon = tileX2lon(minTileX, zoom);
  const tileOriginLat = tileY2lat(minTileY, zoom);
  const tileEndLon = tileX2lon(maxTileX + 1, zoom);
  const tileEndLat = tileY2lat(maxTileY + 1, zoom);

  const offsetX =
    ((west - tileOriginLon) / (tileEndLon - tileOriginLon)) * tileGridW;
  const offsetY =
    ((tileOriginLat - north) / (tileOriginLat - tileEndLat)) * tileGridH;
  const srcW = ((east - west) / (tileEndLon - tileOriginLon)) * tileGridW;
  const srcH = ((north - south) / (tileOriginLat - tileEndLat)) * tileGridH;

  return {
    minTileX,
    minTileY,
    tiles,
    offsetX,
    offsetY,
    scaleX: widthPx / srcW,
    scaleY: heightPx / srcH,
  };
}

// ── Main generation pipeline ─────────────────────────────────────────────────

export async function generateGeoPdf(config: GeoPdfConfig): Promise<Buffer> {
  // 1. Paper dimensions
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
  const widthPx = mmToPx(paper.w);
  const heightPx = mmToPx(paper.h);
  const widthPt = mmToPt(paper.w);
  const heightPt = mmToPt(paper.h);

  // 2. Memory budget guard
  const mapCanvasBytes = widthPx * heightPx * 4;
  const MAX_CANVAS_BYTES = 200 * 1024 * 1024; // 200MB
  if (mapCanvasBytes > MAX_CANVAS_BYTES) {
    throw new AppError(
      400,
      "Requested export is too large. Try a smaller paper size or lower scale.",
    );
  }

  // 3. Zoom level & extent
  const { north, south, east, west } = config.extent;
  const centreLat = (north + south) / 2;
  const zoom = computeZoom(config.scale, centreLat, DPI);

  // 4. Output canvas — the only canvas allocated for the entire pipeline
  const mapCanvas = createCanvas(widthPx, heightPx);
  const mapCtx = mapCanvas.getContext("2d");

  // 5. Base layer — draw directly onto mapCanvas (no intermediate canvas)
  const sixExportUrl = SIX_EXPORT_URLS[config.baseLayer];

  if (sixExportUrl) {
    await fetchSixExportImageDirect(
      mapCtx,
      sixExportUrl,
      config.extent,
      widthPx,
      heightPx,
    );
  }

  // 6. Overlay tiles from PMTiles archives in S3 — draw directly onto mapCanvas
  if (config.overlays.length > 0) {
    const transform = computeTileToMapTransform(
      zoom,
      north,
      south,
      east,
      west,
      widthPx,
      heightPx,
    );
    const topoBucket = process.env.S3_BUCKET_TOPO ?? "logjam-topo-jobs";
    const s3 = new S3Client({
      region: process.env.AWS_REGION ?? "ap-southeast-2",
    });

    for (const overlayName of config.overlays) {
      const layerDef = MASTER_TOPO_LAYERS.find((l) => l.name === overlayName);
      if (!layerDef) continue;
      const pmtilesKey = `master/${overlayName}.pmtiles`;
      const source = new S3Source(topoBucket, pmtilesKey, s3);
      const archive = new PMTiles(source);
      if (layerDef.format === "vector") {
        await fetchAndDrawPMTilesVectorDirect(
          mapCtx,
          transform.tiles,
          archive,
          transform,
          overlayName,
          zoom,
        );
      } else {
        await fetchAndDrawPMTilesRasterDirect(
          mapCtx,
          transform.tiles,
          archive,
          transform,
        );
      }
    }
  }

  // 6b. Canyon markers
  if (config.canyonMarkers && config.canyonMarkers.length > 0) {
    drawCanyonMarkers(mapCtx, config, widthPx, heightPx);
  }

  // 7. Draw map elements
  if (config.elements.gridLines) {
    drawGridLines(mapCtx, config, widthPx, heightPx);
  }

  // Bottom-left element stack
  const elementMargin = mmToPx(5);
  const elementPadH = mmToPx(2);
  const elementPadV = mmToPx(1.5);
  let stackY = heightPx - elementMargin;

  if (config.elements.scaleBar) {
    stackY = drawScaleBar(
      mapCtx,
      config,
      widthPx,
      stackY,
      elementMargin,
      elementPadH,
      elementPadV,
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
    );
  }

  if (config.elements.contourInterval !== undefined) {
    stackY = drawContourInterval(
      mapCtx,
      config.elements.contourInterval,
      stackY,
      elementMargin,
      elementPadH,
      elementPadV,
    );
  }

  if (config.elements.compass) {
    stackY = drawCompass(mapCtx, config, stackY, elementMargin);
  }

  if (config.elements.title) {
    drawTitle(
      mapCtx,
      config.elements.title,
      elementMargin,
      elementPadH,
      elementPadV,
    );
  }

  // Attribution bottom-right
  drawAttribution(mapCtx, widthPx, heightPx, elementMargin);

  // 8. Build PDF with GeoPDF georeferencing metadata
  const pdfBuffer = await buildPdf(mapCanvas, widthPt, heightPt, config);

  return pdfBuffer;
}

// ── SIX Maps ArcGIS export ──────────────────────────────────────────────────

/**
 * Fetch a full-resolution image from a SIX Maps ArcGIS MapServer/export endpoint
 * and draw directly onto the output canvas. No intermediate canvas is allocated.
 */
async function fetchSixExportImageDirect(
  mapCtx: CanvasRenderingContext2D,
  exportUrl: string,
  extent: { north: number; south: number; east: number; west: number },
  widthPx: number,
  heightPx: number,
): Promise<void> {
  // Split into chunks if either dimension exceeds the server limit
  const cols = Math.ceil(widthPx / MAX_EXPORT_SIZE);
  const rows = Math.ceil(heightPx / MAX_EXPORT_SIZE);
  const lonRange = extent.east - extent.west;
  const latRange = extent.north - extent.south;

  type Chunk = { col: number; row: number };
  const chunks: Chunk[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      chunks.push({ col, row });
    }
  }

  await pMap(
    chunks,
    async ({ col, row }) => {
      const pxLeft = col * MAX_EXPORT_SIZE;
      const pxTop = row * MAX_EXPORT_SIZE;
      const chunkW = Math.min(MAX_EXPORT_SIZE, widthPx - pxLeft);
      const chunkH = Math.min(MAX_EXPORT_SIZE, heightPx - pxTop);

      const chunkWest = extent.west + (pxLeft / widthPx) * lonRange;
      const chunkEast = extent.west + ((pxLeft + chunkW) / widthPx) * lonRange;
      const chunkNorth = extent.north - (pxTop / heightPx) * latRange;
      const chunkSouth =
        extent.north - ((pxTop + chunkH) / heightPx) * latRange;

      const params = new URLSearchParams({
        bbox: `${chunkWest},${chunkSouth},${chunkEast},${chunkNorth}`,
        bboxSR: "4326",
        size: `${chunkW},${chunkH}`,
        dpi: `${DPI}`,
        format: "png",
        f: "image",
        transparent: "true",
      });

      const url = `${exportUrl}?${params.toString()}`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60_000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuf = await response.arrayBuffer();
        const img = await loadImage(Buffer.from(arrayBuf));
        mapCtx.drawImage(
          img,
          0,
          0,
          img.width,
          img.height,
          pxLeft,
          pxTop,
          chunkW,
          chunkH,
        );
      } catch (err) {
        mapCtx.fillStyle = "#e8e8e8";
        mapCtx.fillRect(pxLeft, pxTop, chunkW, chunkH);
        console.warn(
          `Failed to fetch SIX export chunk col=${col} row=${row}: ${err}`,
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

/** Fetch raster PMTiles and draw directly onto the output canvas */
async function fetchAndDrawPMTilesRasterDirect(
  mapCtx: CanvasRenderingContext2D,
  tiles: TileCoord[],
  archive: PMTiles,
  transform: TileToMapTransform,
): Promise<void> {
  await pMap(
    tiles,
    async (tile) => {
      try {
        const result = await archive.getZxy(tile.z, tile.x, tile.y);
        if (!result?.data) return;
        const img = await loadImage(Buffer.from(result.data));
        const destX =
          ((tile.x - transform.minTileX) * TILE_SIZE - transform.offsetX) *
          transform.scaleX;
        const destY =
          ((tile.y - transform.minTileY) * TILE_SIZE - transform.offsetY) *
          transform.scaleY;
        const destW = TILE_SIZE * transform.scaleX;
        const destH = TILE_SIZE * transform.scaleY;
        mapCtx.drawImage(
          img,
          0,
          0,
          TILE_SIZE,
          TILE_SIZE,
          destX,
          destY,
          destW,
          destH,
        );
      } catch (err) {
        console.warn(
          `Failed to fetch raster PMTile ${tile.z}/${tile.x}/${tile.y}: ${err}`,
        );
      }
    },
    CONCURRENCY,
  );
}

/** Fetch vector PMTiles and render features directly onto the output canvas */
async function fetchAndDrawPMTilesVectorDirect(
  mapCtx: CanvasRenderingContext2D,
  tiles: TileCoord[],
  archive: PMTiles,
  transform: TileToMapTransform,
  layerName: string,
  zoom: number,
): Promise<void> {
  await pMap(
    tiles,
    async (tile) => {
      try {
        const result = await archive.getZxy(tile.z, tile.x, tile.y);
        if (!result?.data) return;
        const vt = new VectorTile(new Pbf(result.data));
        const tileDx =
          ((tile.x - transform.minTileX) * TILE_SIZE - transform.offsetX) *
          transform.scaleX;
        const tileDy =
          ((tile.y - transform.minTileY) * TILE_SIZE - transform.offsetY) *
          transform.scaleY;
        const sourceLayer = vt.layers[layerName];
        if (!sourceLayer) return;
        for (let i = 0; i < sourceLayer.length; i++) {
          const feature = sourceLayer.feature(i);
          renderVectorFeature(
            mapCtx,
            feature,
            tileDx,
            tileDy,
            zoom,
            layerName,
            transform.scaleX,
            transform.scaleY,
          );
        }
      } catch (err) {
        console.warn(
          `Failed to render vector PMTile ${tile.z}/${tile.x}/${tile.y}: ${err}`,
        );
      }
    },
    CONCURRENCY,
  );
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderVectorFeature(
  ctx: CanvasRenderingContext2D,
  feature: any,
  dx: number,
  dy: number,
  zoom: number,
  layerName: string,
  transformScaleX = 1,
  transformScaleY = 1,
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
      zoom,
      scaleX,
      scaleY,
      geomType,
      props,
    );
  } else if (layerName === "features") {
    renderOsmFeature(
      ctx,
      feature,
      dx,
      dy,
      zoom,
      scaleX,
      scaleY,
      geomType,
      props,
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderContourFeature(
  ctx: CanvasRenderingContext2D,
  feature: any,
  dx: number,
  dy: number,
  zoom: number,
  scaleX: number,
  scaleY: number,
  geomType: number,
  props: Record<string, unknown>,
) {
  if (geomType !== 2) return; // contours are lines
  const elev = Number(props.elev ?? 0);
  const isMajor = elev % 50 === 0;

  // Minor contours only visible at z13+
  if (!isMajor && zoom < 13) return;

  const lineWidth = isMajor
    ? interpZoom(zoom, 12, 1, 18, 2.5)
    : interpZoom(zoom, 12, 0.5, 18, 1.2);
  const color = isMajor ? "rgba(80, 60, 40, 0.85)" : "rgba(120, 90, 60, 0.55)";

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

    // Draw elevation label on major contours at z14+
    if (isMajor && zoom >= 14 && ring.length >= 2) {
      const mid = Math.floor(ring.length / 2);
      const mx = dx + ring[mid].x * scaleX;
      const my = dy + ring[mid].y * scaleY;

      // Calculate angle from adjacent points for text rotation
      const prev = mid > 0 ? mid - 1 : 0;
      const next = mid < ring.length - 1 ? mid + 1 : ring.length - 1;
      const ax = (ring[next].x - ring[prev].x) * scaleX;
      const ay = (ring[next].y - ring[prev].y) * scaleY;
      let angle = Math.atan2(ay, ax);
      // Keep text upright
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;

      const fontSize = interpZoom(zoom, 14, 9, 18, 12);
      const label = `${elev}m`;

      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.font = `600 ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Halo
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 3;
      ctx.strokeText(label, 0, 0);
      // Text
      ctx.fillStyle = "rgba(80, 60, 40, 0.9)";
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
}

const POINT_CATEGORIES = new Set([
  "campsite",
  "peak",
  "spring",
  "gate",
  "viewpoint",
  "cave",
  "picnic",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderOsmFeature(
  ctx: CanvasRenderingContext2D,
  feature: any,
  dx: number,
  dy: number,
  zoom: number,
  scaleX: number,
  scaleY: number,
  geomType: number,
  props: Record<string, unknown>,
) {
  const category = String(props._category ?? "");
  const geometry = feature.loadGeometry();

  switch (category) {
    case "waterway":
      drawLineFeature(ctx, geometry, dx, dy, scaleX, scaleY, {
        color: "rgba(40,120,220,0.85)",
        width: interpZoom(zoom, 12, 1, 18, 3),
      });
      break;
    case "track":
      drawLineFeature(ctx, geometry, dx, dy, scaleX, scaleY, {
        color: "rgba(160,100,30,0.85)",
        width: interpZoom(zoom, 12, 0.8, 18, 2),
        dash: [4, 2],
      });
      break;
    case "road":
      drawLineFeature(ctx, geometry, dx, dy, scaleX, scaleY, {
        color: "rgba(80,80,80,0.9)",
        width: interpZoom(zoom, 12, 1, 18, 4),
      });
      break;
    case "building":
      if (geomType === 3) {
        drawFillFeature(ctx, geometry, dx, dy, scaleX, scaleY, {
          fill: "rgba(160,140,120,0.3)",
          outline: "rgba(160,140,120,0.8)",
        });
      }
      break;
    case "power":
      drawLineFeature(ctx, geometry, dx, dy, scaleX, scaleY, {
        color: "rgba(200,160,0,0.8)",
        width: 1,
        dash: [3, 4],
      });
      break;
    default:
      if (POINT_CATEGORIES.has(category) && geomType === 1) {
        const radius = interpZoom(zoom, 12, 3, 18, 7);
        for (const ring of geometry) {
          for (const pt of ring) {
            const px = dx + pt.x * scaleX;
            const py = dy + pt.y * scaleY;
            ctx.beginPath();
            ctx.arc(px, py, radius, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0,140,80,0.9)";
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
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
) {
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "white";
  drawRoundedRect(ctx, x, y, w, h, mmToPx(1));
  ctx.fill();
  ctx.restore();
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  margin: number,
  padH: number,
  padV: number,
) {
  const fontSize = mmToPx(4);
  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(title);
  const boxW = metrics.width + padH * 2;
  const boxH = fontSize + padV * 2;
  const x = margin;
  const y = margin;

  drawElementBackground(ctx, x, y, boxW, boxH);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillText(title, x + padH, y + padV + fontSize * 0.85);
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  config: GeoPdfConfig,
  canvasWidth: number,
  stackY: number,
  margin: number,
  padH: number,
  padV: number,
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
  const barHeight = mmToPx(2);
  const fontSize = mmToPx(2.5);
  const segments = 4;
  const segWidth = barWidthPx / segments;

  const labelText = formatDistance(barDistM);
  ctx.font = `${fontSize}px sans-serif`;
  const labelW = ctx.measureText(labelText).width;

  const boxW = barWidthPx + padH * 2 + labelW + mmToPx(2);
  const boxH = barHeight + fontSize + padV * 3;
  const x = margin;
  const y = stackY - boxH;

  drawElementBackground(ctx, x, y, boxW, boxH);

  // Draw alternating segments
  for (let i = 0; i < segments; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#1a1a1a" : "white";
    ctx.fillRect(x + padH + i * segWidth, y + padV, segWidth, barHeight);
  }

  // Bar border
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + padH, y + padV, barWidthPx, barHeight);

  // Labels
  ctx.fillStyle = "#1a1a1a";
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillText("0", x + padH, y + padV + barHeight + fontSize + mmToPx(0.5));
  ctx.fillText(
    labelText,
    x + padH + barWidthPx + mmToPx(1),
    y + padV + barHeight / 2 + fontSize * 0.35,
  );

  return y - mmToPx(1);
}

function drawScaleText(
  ctx: CanvasRenderingContext2D,
  config: GeoPdfConfig,
  stackY: number,
  margin: number,
  padH: number,
  padV: number,
): number {
  const text = `1:${Math.round(config.scale).toLocaleString()}`;
  const fontSize = mmToPx(3);
  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const boxW = metrics.width + padH * 2;
  const boxH = fontSize + padV * 2;
  const x = margin;
  const y = stackY - boxH;

  drawElementBackground(ctx, x, y, boxW, boxH);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillText(text, x + padH, y + padV + fontSize * 0.85);

  return y - mmToPx(1);
}

function drawContourInterval(
  ctx: CanvasRenderingContext2D,
  interval: number,
  stackY: number,
  margin: number,
  padH: number,
  padV: number,
): number {
  const text = `${interval}m contours`;
  const fontSize = mmToPx(2.5);
  ctx.font = `${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const boxW = metrics.width + padH * 2;
  const boxH = fontSize + padV * 2;
  const x = margin;
  const y = stackY - boxH;

  drawElementBackground(ctx, x, y, boxW, boxH);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillText(text, x + padH, y + padV + fontSize * 0.85);

  return y - mmToPx(1);
}

function drawCompass(
  ctx: CanvasRenderingContext2D,
  config: GeoPdfConfig,
  stackY: number,
  margin: number,
): number {
  const midLat = (config.extent.north + config.extent.south) / 2;
  const midLon = (config.extent.east + config.extent.west) / 2;

  // Magnetic declination
  const model = geomagnetism.model();
  const magInfo = model.point([midLat, midLon]);
  const magDecl = magInfo.decl as number; // degrees, positive = east

  // Grid convergence
  const gridConv = gridConvergence(midLat, midLon);

  const boxW = mmToPx(40);
  const arrowLen = mmToPx(15);
  const arrowSectionH = arrowLen + mmToPx(6); // headroom above + tip
  const legendRowH = mmToPx(6);
  const legendRows = 3;
  const boxH = arrowSectionH + legendRows * legendRowH + mmToPx(4); // 4mm bottom pad

  const boxX = margin;
  const boxY = stackY - boxH;

  drawElementBackground(ctx, boxX, boxY, boxW, boxH);

  // Arrow origin: horizontally centred, with arrowLen of space above
  const cx = boxX + boxW / 2;
  const cy = boxY + mmToPx(3) + arrowLen; // 3mm top pad + arrow length

  // Draw a single north arrow (no tip labels)
  function drawArrow(angleDeg: number, color: string) {
    const angleRad = -angleDeg * DEG_TO_RAD;
    const tipX = cx + Math.sin(angleRad) * arrowLen;
    const tipY = cy - Math.cos(angleRad) * arrowLen;

    ctx.strokeStyle = color;
    ctx.lineWidth = mmToPx(0.4);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Filled arrowhead
    const headLen = mmToPx(2.5);
    const headAngle = 0.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX - headLen * Math.sin(angleRad - headAngle),
      tipY + headLen * Math.cos(angleRad - headAngle),
    );
    ctx.lineTo(
      tipX - headLen * Math.sin(angleRad + headAngle),
      tipY + headLen * Math.cos(angleRad + headAngle),
    );
    ctx.closePath();
    ctx.fill();
  }

  // Draw all three arrows (MN first so TN/GN render on top)
  drawArrow(magDecl, "#16a34a");
  drawArrow(gridConv, "#2563eb");
  drawArrow(0, "#e11d48");

  // Legend: coloured line swatch + label text
  const legendFontSize = mmToPx(2.5);
  const swatchLen = mmToPx(5);
  const swatchLineW = mmToPx(0.5);
  const legendX = boxX + mmToPx(3);
  const legendTextX = legendX + swatchLen + mmToPx(2);
  let legendY = boxY + arrowSectionH + mmToPx(1);

  ctx.font = `${legendFontSize}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "start";

  const entries: [string, string, string][] = [
    ["#e11d48", "TN", "True North"],
    [
      "#2563eb",
      "GN",
      `Grid North (${gridConv >= 0 ? "+" : ""}${gridConv.toFixed(2)}°)`,
    ],
    [
      "#16a34a",
      "MN",
      `Mag. North (${magDecl >= 0 ? "+" : ""}${magDecl.toFixed(1)}°)`,
    ],
  ];

  for (const [color, abbr, desc] of entries) {
    const rowMidY = legendY + legendRowH / 2;

    // Coloured swatch line
    ctx.strokeStyle = color;
    ctx.lineWidth = swatchLineW;
    ctx.beginPath();
    ctx.moveTo(legendX, rowMidY);
    ctx.lineTo(legendX + swatchLen, rowMidY);
    ctx.stroke();

    // Abbreviation (bold) + description (description currently omitted to save space)
    ctx.fillStyle = "#1a1a1a";
    ctx.font = `bold ${legendFontSize}px sans-serif`;
    ctx.fillText(abbr, legendTextX, rowMidY);
    const abbrW = ctx.measureText(abbr + " ").width;
    ctx.font = `${legendFontSize}px sans-serif`;
    // ctx.fillText(desc, legendTextX + abbrW, rowMidY);

    legendY += legendRowH;
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
) {
  const { north, south, east, west } = config.extent;
  const radius = mmToPx(2);
  const labelFontSize = mmToPx(2.5);

  for (const marker of config.canyonMarkers!) {
    const x = ((marker.lon - west) / (east - west)) * widthPx;
    const y = ((north - marker.lat) / (north - south)) * heightPx;

    // Skip markers outside canvas bounds
    if (x < -radius || x > widthPx + radius || y < -radius || y > heightPx + radius) continue;

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
      ctx.font = `${labelFontSize}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      const labelX = x + radius + mmToPx(1);
      const labelY = y;

      // White halo for legibility
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(marker.name, labelX, labelY);

      ctx.fillStyle = "#1a1a1a";
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
 * E.g. for 6292000 at 1km interval: "62" small + "92" large bold + "000" small
 * E.g. for 6292000 at 10km interval (shown as 6292): "62" small + "92" large bold
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

  ctx.font = `${smallFontSize}px sans-serif`;
  ctx.fillText(prefix, curX, y);
  curX += ctx.measureText(prefix).width;

  ctx.font = `bold ${largeFontSize}px sans-serif`;
  ctx.fillText(principal, curX, y);
  curX += ctx.measureText(principal).width;

  if (interval < 10000) {
    ctx.font = `${smallFontSize}px sans-serif`;
    ctx.fillText("000", curX, y);
  }

  // Restore font
  ctx.font = `${smallFontSize}px sans-serif`;
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  config: GeoPdfConfig,
  widthPx: number,
  heightPx: number,
) {
  const { north, south, east, west } = config.extent;
  const fontSize = mmToPx(2);
  const largeFontSize = mmToPx(3.2);
  ctx.font = `${fontSize}px sans-serif`;
  ctx.strokeStyle = "rgba(40, 40, 40, 0.6)";
  ctx.fillStyle = "rgba(20, 20, 20, 0.9)";
  ctx.lineWidth = 1.5;

  if (config.elements.gridLines === "enNorthing") {
    // MGA easting/northing grid — convert each grid coordinate via
    // MGA → lat/lon → pixel so lines align with the geographic canvas.
    const interval = config.scale <= 25000 ? 1000 : 10000;

    // Use a single MGA zone based on the map centre to avoid cross-zone issues
    const midLon = (east + west) / 2;
    const zone = detectMgaZone(midLon);

    const swEN = toEastingNorthing(south, west);
    const neEN = toEastingNorthing(north, east);

    // Helper: lat/lon → canvas pixel (matches the geographic-linear canvas)
    function toPixel(lat: number, lon: number) {
      const x = ((lon - west) / (east - west)) * widthPx;
      const y = ((north - lat) / (north - south)) * heightPx;
      return { x, y };
    }

    // Vertical lines (constant easting, varying northing)
    const startE = Math.ceil(swEN.easting / interval) * interval;
    const endE = Math.floor(neEN.easting / interval) * interval;
    for (let e = startE; e <= endE; e += interval) {
      // Convert top and bottom endpoints from MGA to lat/lon then to pixel
      const topLL = fromEastingNorthing(e, neEN.northing, zone);
      const botLL = fromEastingNorthing(e, swEN.northing, zone);
      const topPx = toPixel(topLL.lat, topLL.lon);
      const botPx = toPixel(botLL.lat, botLL.lon);
      ctx.beginPath();
      ctx.moveTo(topPx.x, topPx.y);
      ctx.lineTo(botPx.x, botPx.y);
      ctx.stroke();
      drawGridLabel(ctx, e, interval, topPx.x + 2, fontSize + 2, fontSize, largeFontSize);
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
      const frac = (lat - south) / (north - south);
      const y = heightPx - frac * heightPx;
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
      ctx.fillText(lon.toFixed(4) + "°", x + 2, fontSize + 2);
    }
  }
}

function drawAttribution(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
  margin: number,
) {
  const fontSize = mmToPx(1.8);
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = "rgba(60, 60, 60, 0.8)";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("Generated by Logjam", widthPx - margin, heightPx - margin);
  ctx.fillText(
    "Map data © OpenStreetMap contributors",
    widthPx - margin,
    heightPx - margin - fontSize - mmToPx(0.5),
  );
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

// ── PDF assembly with GeoPDF metadata ────────────────────────────────────────

async function buildPdf(
  mapCanvas: Canvas,
  widthPt: number,
  heightPt: number,
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

    // Embed the map image as full-page
    const imgBuffer = mapCanvas.toBuffer("image/jpeg", { quality: 0.92 });
    doc.image(imgBuffer, 0, 0, { width: widthPt, height: heightPt });

    // GeoPDF georeferencing metadata
    // Reference: PDF 1.7 specification, Section 8.7.2 — Geospatial features
    // and OGC GeoPDF specification.
    //
    // We attach a Viewport dictionary to the page with GPTS (geographic tie
    // points in WGS84) and LPTS (normalised page coordinates). This allows
    // GIS software like QGIS and Avenza Maps to read coordinate information.
    try {
      const { north, south, east, west } = config.extent;

      // WGS84 Well-Known Text for the GCS
      const wgs84Wkt =
        'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",' +
        'SPHEROID["WGS_1984",6378137,298.257223563]],' +
        'PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';

      const gcsRef = (doc as any).ref({
        Type: "PROJCS",
        WKT: wgs84Wkt,
      });
      gcsRef.end();

      const measureRef = (doc as any).ref({
        Type: "Measure",
        Subtype: "GEO",
        // GPTS: four corners in lat/lon order — BL, BR, TR, TL
        GPTS: [south, west, south, east, north, east, north, west],
        // LPTS: corresponding normalised page coordinates (0,0 = bottom-left)
        LPTS: [0, 0, 1, 0, 1, 1, 0, 1],
        GCS: gcsRef,
      });
      measureRef.end();

      const viewportRef = (doc as any).ref({
        Type: "Viewport",
        BBox: [0, 0, widthPt, heightPt],
        Measure: measureRef,
      });
      viewportRef.end();

      // Attach viewport to the current page
      const page = (doc as any)._root.data.Pages.data.Kids[0];
      if (page && page.data) {
        page.data.VP = [viewportRef];
      }
    } catch (err) {
      // If GeoPDF metadata injection fails, continue without it.
      // The PDF will still render correctly but won't have georeferencing.
      console.warn("Failed to inject GeoPDF metadata:", err);
    }

    doc.end();
  });
}
