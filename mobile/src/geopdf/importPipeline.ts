// GeoPDF import pipeline (Stage 6 §6.1):
//   copying → hashing → parsing → planning → rasterising(zMax) → overviews →
//   finalising → ready | failed(code)
//
// All geodesy runs in JS (shared/geoPdfImport); all pixel work runs in the
// native module (render, warp, PNG, SQLite) — no bitmap crosses the bridge.
// The tile plan is deterministic from the source bytes, so resume re-derives
// it and skips completed work via the MBTiles logjam:build_state row.
//
// THE PIPELINE TAKES A FILE URI, NEVER BYTES, and that is a hard rule now.
// Everything before rasterising used to run through the JS heap: a sync
// whole-file read, a Uint8Array handed to expo-crypto (another full copy across
// the bridge), then a sync write back out — and on the share-sheet path, a
// base64 read plus a char-at-a-time `atob` over eight million elements. All of
// it on the UI thread, all of it before the first tile. The bytes now enter JS
// exactly once, for the pdf-lib parse, and become unreachable the moment it
// returns (see `parseSourcePdf`). Hashing is native and streamed; copying is a
// filesystem copy.
//
// PRIVACY: the whole flow is device-local — nothing about the file (including
// its existence) touches the API. Errors surfaced to the UI are static
// strings or parser error CODES; file-derived detail stays in-app.
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { Directory, File, Paths } from "expo-file-system/next";

import {
  GeoPdfParseError,
  chooseMainViewport,
  parseGeoPdfGeoref,
  rebaseViewportToRenderBox,
  type GeoPdfViewport,
} from "@logjam/shared/dist/geoPdfImport/parseGeoref.js";
import {
  RESIDUAL_WARN_FRACTION,
  buildGeoTransform,
  type GeoTransform,
  type XY,
} from "@logjam/shared/dist/geoPdfImport/transform.js";
import {
  buildTilePlan,
  type TilePlan,
} from "@logjam/shared/dist/geoPdfImport/tilePlan.js";

import LogjamPdfRenderer from "../../modules/logjam-pdf-renderer/src/LogjamPdfRendererModule";
import { insertArtifact, deleteArtifact } from "../offline/registryDb";
import { randomId } from "../imports/vectorImports";
import {
  deleteGeoPdfImportRow,
  findGeoPdfImportBySha256,
  insertGeoPdfImport,
  listGeoPdfImports,
  updateGeoPdfImport,
  type GeoPdfImport,
  type GeoPdfImportState,
} from "./geoPdfImportsDb";

/** Reject absurd files before loading them into memory (spec §2.1). */
const MAX_GEOPDF_FILE_BYTES = 300 * 1024 * 1024;
/** Tiles per native call — the progress/cancel granularity (spec §4.1). */
const BATCH_SIZE = 32;
const PARSER_VERSION = 1;

export { RESIDUAL_WARN_FRACTION };

// Static user-facing messages per error code — never file content.
/**
 * The renderer and the georeference parser must agree on the page rectangle.
 *
 * They can disagree in two ways, and both put the map somewhere it isn't:
 *
 *  - `/Rotate 90|270`. pdfium SWAPS the page size and renders into a rotated,
 *    top-left-origin space, while the parser reports the MediaBox and the
 *    viewport BBox in unrotated user space (which is where the spec defines
 *    them). The tiles are georeferenced correctly and filled with pixels
 *    scraped from a 90°-rotated region — an error of order the page dimension,
 *    which at 1:25 000 is kilometres.
 *  - A CropBox or MediaBox whose origin is not (0,0). pdfium renders the
 *    CropBox ∩ MediaBox from ITS corner; the renderer's page-to-region maths
 *    assumes the box starts at the origin. The whole overlay shifts by the box
 *    offset — 159 m for a ¼″ trim at 1:25 000, and it looks entirely plausible
 *    on screen, which is the worst way for an overlay to be wrong.
 *
 * Neither is supported yet, so this refuses the import rather than producing a
 * confidently misplaced map. Fixing either means teaching the native renderer
 * about rotation and the crop origin; until then, failing loud is the honest
 * behaviour (root CLAUDE.md: no silent fallbacks).
 */
function assertRendererPageMatchesGeoref(
  rendered: { widthPt: number; heightPt: number } | undefined,
  page: {
    renderBoxPt: { width: number; height: number };
    rotationDeg: number;
  },
): void {
  if (!rendered) throw new Error(GEOPDF_ERRORS.RENDER_FAILED);
  // /Rotate is checked on its own value, not inferred from the dimensions.
  // 90 and 270 swap them, but 180 does not — so a dimension comparison alone
  // waved through an upside-down page and fetched every tile from the
  // diagonally opposite corner of the sheet.
  if (page.rotationDeg !== 0) throw new Error(GEOPDF_ERRORS.UNSUPPORTED_PAGE_BOX);
  // Belt and braces: the box we rebased onto must be the one being rendered.
  // pdfium rounds to whole points; a point of slack costs 8.8 m at 1:25 000,
  // which is inside GPS noise, and anything real is off by tens of points.
  const TOLERANCE_PT = 1;
  const matches =
    Math.abs(rendered.widthPt - page.renderBoxPt.width) <= TOLERANCE_PT &&
    Math.abs(rendered.heightPt - page.renderBoxPt.height) <= TOLERANCE_PT;
  if (!matches) throw new Error(GEOPDF_ERRORS.UNSUPPORTED_PAGE_BOX);
}

export const GEOPDF_ERRORS: Record<string, string> = {
  NOT_A_PDF: "This file isn't a readable PDF.",
  ENCRYPTED: "This PDF is encrypted and can't be imported.",
  NO_GEOREF: "This PDF has no georeferencing — it can't be placed on the map.",
  LGIDICT_ONLY:
    "This GeoPDF uses an older georeferencing format that isn't supported yet.",
  MALFORMED_GEOREF: "This PDF's georeferencing is malformed.",
  UNSUPPORTED_PAGE_BOX:
    "This PDF's page is rotated in a way Logjam can't place accurately.",
  UNSUPPORTED_CRS: "This PDF uses a map projection that isn't supported.",
  FILE_TOO_LARGE: "This PDF is too large to import (300 MB limit).",
  RENDER_FAILED: "Rendering this PDF failed.",
};

export interface GeoPdfProgress {
  phase: GeoPdfImportState;
  /** 0–1 within the rasterising/overviews phases; 0 elsewhere. */
  fraction: number;
  /**
   * The registry row's id, once one exists — hashing and copying happen before
   * the row is inserted. The Saved list needs it to tell which of its rows the
   * running import belongs to.
   */
  importId?: string;
  /**
   * The file's own name, once known. The picker flow can't name the import
   * until the user has chosen something, and a resume starts from an id, so
   * the progress card opens on a placeholder and is corrected from here.
   */
  label?: string;
}

export interface GeoPdfCancelToken {
  cancelled: boolean;
}

export type GeoPdfImportOutcome =
  | { status: "imported"; record: GeoPdfImport }
  | { status: "existing"; record: GeoPdfImport }
  | { status: "paused"; record: GeoPdfImport }
  | { status: "cancelled" };

interface BuildState {
  phase: "rasterising" | "overviews";
  zMax: number;
  nextTileIndex?: number;
  /** Next zoom to downsample INTO (fromZ = downsampleZ + 1). */
  downsampleZ?: number;
}

function importsRootDir(): Directory {
  return new Directory(Paths.document, "imports", "geopdf");
}

/**
 * Time one step of the front half and log it. Durations and step names only —
 * nothing about the file. The front phases are the ones that can hold the UI
 * thread, so which of them costs what is the difference between a fix and a
 * guess.
 */
async function step<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await run();
  } finally {
    console.log(`[geopdf] ${name} ${Date.now() - startedAt} ms`);
  }
}

/**
 * Read and parse the copied source PDF.
 *
 * Its own function purely so the whole-file buffer is unreachable the moment it
 * returns. pdf-lib needs the bytes and there is no way around that, but holding
 * 8–100 MB live through the minutes of rasterising that follow is GC pressure
 * for nothing — nothing downstream reads them, the native side works from the
 * file on disk.
 */
async function parseSourcePdf(dirPath: string) {
  const bytes = await step("read-bytes", () =>
    new File(`file://${dirPath}/source.pdf`).bytes(),
  );
  return step("pdf-parse", () => parseGeoPdfGeoref(bytes));
}

/**
 * A `file://` URI for `uri`, staging a `content://` one into the cache first.
 *
 * The share sheet hands over a content URI, which neither the native hasher nor
 * `expo-file-system/next` can open. The legacy `copyAsync` can, and does it
 * natively; the alternative was reading the file as base64 into JS and decoding
 * it by hand, which is what this replaces.
 */
async function stagedFileUri(uri: string): Promise<{ uri: string; scratch: string | null }> {
  if (uri.startsWith("file://")) return { uri, scratch: null };
  const scratch = `${FileSystem.cacheDirectory}geopdf-incoming-${randomId()}.pdf`;
  await FileSystem.copyAsync({ from: uri, to: scratch });
  return { uri: scratch, scratch };
}

function clipPolygonOf(viewport: GeoPdfViewport): XY[] {
  return (
    viewport.boundsPolygonPt ?? [
      { x: viewport.bboxPt.x0, y: viewport.bboxPt.y0 },
      { x: viewport.bboxPt.x1, y: viewport.bboxPt.y0 },
      { x: viewport.bboxPt.x1, y: viewport.bboxPt.y1 },
      { x: viewport.bboxPt.x0, y: viewport.bboxPt.y1 },
    ]
  );
}

function georefDiagnostics(
  viewport: GeoPdfViewport,
  transform: GeoTransform,
  plan: TilePlan,
): string {
  // Everything needed to diagnose a placement bug from the artifact alone.
  // Lives inside the app-private MBTiles — same privacy class as the PDF.
  return JSON.stringify({
    parserVersion: PARSER_VERSION,
    controlPoints: viewport.controlPoints,
    crs: viewport.crs,
    quirks: viewport.quirks,
    kind: transform.kind,
    planeCrs: transform.planeCrs,
    maxResidualFractionOfWidth: transform.maxResidualFractionOfWidth,
    zMin: plan.zMin,
    zMax: plan.zMax,
  });
}

/**
 * Pick a PDF and run the full import. Returns `existing` when the same bytes
 * (sha256) were already imported and are ready.
 */
export async function importGeoPdfFromPicker(
  onProgress: (progress: GeoPdfProgress) => void,
  token: GeoPdfCancelToken,
): Promise<GeoPdfImportOutcome> {
  const picked = await DocumentPicker.getDocumentAsync({
    // AirDropped/downloaded PDFs don't reliably carry application/pdf on
    // Android file providers — accept everything, the parser rejects non-PDFs.
    type: "*/*",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled || picked.assets.length === 0) return { status: "cancelled" };
  const asset = picked.assets[0];
  if (asset.size != null && asset.size > MAX_GEOPDF_FILE_BYTES) {
    throw new Error(GEOPDF_ERRORS.FILE_TOO_LARGE);
  }
  return importGeoPdfFile(asset.name, asset.uri, onProgress, token);
}

/**
 * Import a GeoPDF from a file the OS has given us — the picker, a share-sheet
 * content URI, or a downloaded scratch file. Never takes bytes; see the header.
 */
export async function importGeoPdfFile(
  displayName: string,
  fileUri: string,
  onProgress: (progress: GeoPdfProgress) => void,
  token: GeoPdfCancelToken,
): Promise<GeoPdfImportOutcome> {
  const staged = await stagedFileUri(fileUri);
  try {
    return await importStagedFile(displayName, staged.uri, onProgress, token);
  } finally {
    if (staged.scratch) {
      await FileSystem.deleteAsync(staged.scratch, { idempotent: true }).catch(() => {});
    }
  }
}

async function importStagedFile(
  displayName: string,
  fileUri: string,
  onProgress: (progress: GeoPdfProgress) => void,
  token: GeoPdfCancelToken,
): Promise<GeoPdfImportOutcome> {
  const incoming = new File(fileUri);
  const sourceSizeBytes = incoming.size ?? 0;
  if (sourceSizeBytes > MAX_GEOPDF_FILE_BYTES) {
    throw new Error(GEOPDF_ERRORS.FILE_TOO_LARGE);
  }
  const label = displayName.replace(/\.[^.]+$/, "");
  onProgress({ phase: "hashing", fraction: 0, label });
  const sha256 = await step("hash", () => LogjamPdfRenderer.sha256File(fileUri));

  const existing = await findGeoPdfImportBySha256(sha256);
  if (existing) {
    if (existing.state === "ready") return { status: "existing", record: existing };
    // Incomplete prior import of the same bytes: resume it.
    return resumeGeoPdfImport(existing.id, onProgress, token);
  }

  onProgress({ phase: "copying", fraction: 0, label });
  const dir = new Directory(importsRootDir(), sha256);
  if (!dir.exists) dir.create({ intermediates: true });
  const sourceFile = new File(dir, "source.pdf");
  if (sourceFile.exists) sourceFile.delete();
  await step("copy", () => incoming.copy(sourceFile));

  const record: GeoPdfImport = {
    id: randomId(),
    label,
    sha256,
    pageIndex: 0,
    viewportIndex: 0,
    state: "parsing",
    errorCode: null,
    bbox: null,
    minzoom: null,
    maxzoom: null,
    residualFraction: null,
    opacity: 0.8,
    visible: true,
    dirPath: dir.uri.replace(/^file:\/\//, ""),
    sourceSizeBytes,
    quirks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await insertGeoPdfImport(record);
  return buildArtifact(record, onProgress, token);
}

/**
 * Import one of the user's own server-generated GeoPDFs from its presigned
 * download URL (from GET /geo-pdf/). Streams the bytes to a scratch cache file,
 * hands them to the shared byte importer, then discards the scratch file — the
 * durable artifact is the tiled MBTiles, same as the picker flow. The presigned
 * URL carries its own auth in the query string, so no Authorization header is
 * sent (S3 rejects two auth mechanisms).
 */
export async function importGeoPdfFromUrl(
  displayName: string,
  downloadUrl: string,
  onProgress: (progress: GeoPdfProgress) => void,
  token: GeoPdfCancelToken,
): Promise<GeoPdfImportOutcome> {
  const scratchUri = `${FileSystem.cacheDirectory}geopdf-download-${randomId()}.pdf`;
  try {
    const result = await FileSystem.downloadAsync(downloadUrl, scratchUri);
    if (result.status !== 200) {
      throw new Error(`GeoPDF download failed (HTTP ${result.status})`);
    }
    return await importGeoPdfFile(displayName, scratchUri, onProgress, token);
  } finally {
    await FileSystem.deleteAsync(scratchUri, { idempotent: true }).catch(() => {});
  }
}

/** Resume an incomplete import (state ≠ ready/failed acceptable too — retry). */
export async function resumeGeoPdfImport(
  id: string,
  onProgress: (progress: GeoPdfProgress) => void,
  token: GeoPdfCancelToken,
): Promise<GeoPdfImportOutcome> {
  const imports = await listGeoPdfImports();
  const record = imports.find((row) => row.id === id);
  if (!record) throw new Error(GEOPDF_ERRORS.RENDER_FAILED);
  return buildArtifact(record, onProgress, token);
}

async function buildArtifact(
  record: GeoPdfImport,
  onProgress: (progress: GeoPdfProgress) => void,
  token: GeoPdfCancelToken,
): Promise<GeoPdfImportOutcome> {
  const report = (phase: GeoPdfImportState, fraction: number) =>
    onProgress({ phase, fraction, importId: record.id, label: record.label });
  const setState = async (state: GeoPdfImportState) => {
    await updateGeoPdfImport(record.id, { state });
    report(state, 0);
  };

  try {
    await setState("parsing");
    const parsed = await parseSourcePdf(record.dirPath);
    const page = parsed.pages[0];
    const viewportIndex = chooseMainViewport(page);
    // Everything downstream of here — transform, clip polygon, tile plan, warp
    // meshes — is handed to the native rasteriser, whose pixel origin is the
    // render box's corner rather than user-space (0,0). Rebasing once, here,
    // puts all of it in renderer space and keeps the two from drifting apart.
    const viewport = rebaseViewportToRenderBox(
      page.viewports[viewportIndex],
      page.renderBoxPt,
    );

    await setState("planning");
    const transform = buildGeoTransform(viewport);
    const clip = clipPolygonOf(viewport);
    const plan = buildTilePlan(transform, clip);
    const { north, south, east, west } = transform.wgs84Bounds;
    await updateGeoPdfImport(record.id, {
      bbox: [west, south, east, north],
      minzoom: plan.zMin,
      maxzoom: plan.zMax,
      residualFraction: transform.maxResidualFractionOfWidth,
      quirks: viewport.quirks,
    });

    const mbtilesUri = `file://${record.dirPath}/tiles.mbtiles`;
    const opened = await LogjamPdfRenderer.open(
      `file://${record.dirPath}/source.pdf`,
    );
    try {
      assertRendererPageMatchesGeoref(opened.pages[page.pageIndex], page);
      await LogjamPdfRenderer.createMbtiles(mbtilesUri, {
        name: record.label,
        format: "png",
        type: "overlay",
        bounds: `${west},${south},${east},${north}`,
        center: `${(west + east) / 2},${(south + north) / 2},${plan.zMin}`,
        minzoom: String(plan.zMin),
        maxzoom: String(plan.zMax),
        "logjam:schema": "1",
        "logjam:kind": "geopdf",
        "logjam:source_sha256": record.sha256,
        "logjam:page": String(page.pageIndex),
        "logjam:viewport_index": String(viewportIndex),
        "logjam:georef": georefDiagnostics(viewport, transform, plan),
      });

      // Resume point from the artifact itself (deterministic plan replays).
      const savedState = await LogjamPdfRenderer.readMbtilesMetadata(
        mbtilesUri,
        "logjam:build_state",
      );
      let resume: BuildState | null = savedState
        ? (JSON.parse(savedState) as BuildState)
        : null;
      // A checkpoint from a different plan (parser/planner change between
      // sessions) is unusable — replay from scratch; inserts are idempotent.
      if (resume && resume.zMax !== plan.zMax) resume = null;
      const startTile =
        resume?.phase === "rasterising" ? (resume.nextTileIndex ?? 0) : null;
      const startDownsampleZ =
        resume?.phase === "overviews" ? (resume.downsampleZ ?? plan.zMax - 1) : null;

      const rasterise = { renderMs: 0, encodeMs: 0, tiles: 0 };
      const rasteriseStartedAt = Date.now();
      if (startDownsampleZ === null) {
        await updateGeoPdfImport(record.id, { state: "rasterising" });
        for (let i = startTile ?? 0; i < plan.tiles.length; i += BATCH_SIZE) {
          if (token.cancelled) return await pause(record);
          report("rasterising", i / plan.tiles.length);
          const buildState: BuildState = {
            phase: "rasterising",
            zMax: plan.zMax,
            nextTileIndex: Math.min(i + BATCH_SIZE, plan.tiles.length),
          };
          const batch = await LogjamPdfRenderer.rasteriseBatch(opened.handle, {
            page: page.pageIndex,
            mbtilesUri,
            tileSize: plan.tileSize,
            clipPolygonPt: clip,
            tiles: plan.tiles.slice(i, i + BATCH_SIZE),
            buildState: JSON.stringify(buildState),
          });
          rasterise.renderMs += batch.renderMs;
          rasterise.encodeMs += batch.encodeMs;
          rasterise.tiles += batch.written;
        }
        // Counts and milliseconds only — nothing about WHICH map this is. The
        // split says whether the next optimisation belongs in how often the
        // page is rendered or in how tiles are encoded; see the note in the
        // native rasteriseBatch.
        console.log(
          `[geopdf] rasterised ${rasterise.tiles} tiles: render ${rasterise.renderMs} ms, encode ${rasterise.encodeMs} ms, other ${
            Date.now() - rasteriseStartedAt - rasterise.renderMs - rasterise.encodeMs
          } ms`,
        );
      }

      await updateGeoPdfImport(record.id, { state: "overviews" });
      const firstZ = startDownsampleZ ?? plan.zMax - 1;
      for (let z = firstZ; z >= plan.zMin; z--) {
        if (token.cancelled) return await pause(record);
        report("overviews", (plan.zMax - 1 - z) / Math.max(1, plan.zMax - plan.zMin));
        const buildState: BuildState = { phase: "overviews", zMax: plan.zMax, downsampleZ: z };
        await LogjamPdfRenderer.downsampleLevel(
          mbtilesUri,
          z + 1,
          plan.tileSize,
          JSON.stringify(buildState),
        );
      }

      await setState("finalising");
      await LogjamPdfRenderer.finalizeMbtiles(mbtilesUri, {});
    } finally {
      await LogjamPdfRenderer.close(opened.handle).catch(() => {});
    }

    const mbtilesFile = new File(mbtilesUri);
    await insertArtifact({
      id: `geopdf-${record.id}`,
      kind: "geopdf-import",
      logicalKey: record.id,
      format: "mbtiles",
      sourceType: "raster",
      path: mbtilesUri.replace(/^file:\/\//, ""),
      bbox: [west, south, east, north],
      minzoom: plan.zMin,
      maxzoom: plan.zMax,
      sizeBytes: mbtilesFile.size ?? 0,
      downloadedAt: new Date().toISOString(),
    });
    await updateGeoPdfImport(record.id, { state: "ready", errorCode: null });
    const done: GeoPdfImport = {
      ...record,
      state: "ready",
      bbox: [west, south, east, north],
      minzoom: plan.zMin,
      maxzoom: plan.zMax,
      residualFraction: transform.maxResidualFractionOfWidth,
      quirks: viewport.quirks,
    };
    report("ready", 1);
    return { status: "imported", record: done };
  } catch (err) {
    const code = err instanceof GeoPdfParseError ? err.code : "RENDER_FAILED";
    await updateGeoPdfImport(record.id, { state: "failed", errorCode: code });
    throw err;
  }
}

async function pause(record: GeoPdfImport): Promise<GeoPdfImportOutcome> {
  // Keep state as-is (rasterising/overviews) — the row + build_state carry
  // everything needed to resume; UI offers Resume/Discard.
  return { status: "paused", record };
}

/** Delete an import: registry row, map artifact, and the whole directory. */
export async function deleteGeoPdfImport(id: string): Promise<void> {
  const record = await deleteGeoPdfImportRow(id);
  await deleteArtifact(`geopdf-${id}`).catch(() => null);
  if (record) {
    const dir = new Directory(`file://${record.dirPath}`);
    if (dir.exists) dir.delete();
  }
}
