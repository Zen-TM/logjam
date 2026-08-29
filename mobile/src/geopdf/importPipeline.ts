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
import * as FileSystem from "expo-file-system/legacy";
import { Directory, File } from "expo-file-system";

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
  GEOPDF_PARSER_VERSION,
  buildTilePlan,
  estimateGeoPdfImport,
  resumableFrom,
  type GeoPdfBuildState,
  type GeoPdfImportEstimate,
  type TilePlan,
} from "@logjam/shared/dist/geoPdfImport/tilePlan.js";

import LogjamPdfRenderer from "../../modules/logjam-pdf-renderer/src/LogjamPdfRendererModule";
import { IMPORTS_DIR, scratchFileUri } from "../offline/localStores";
import { NotEnoughSpaceError, assertSpaceFor } from "../offline/freeSpace";
import { insertArtifact, deleteArtifact } from "../offline/registryDb";
import { randomId } from "../imports/vectorImports";
import { stageIncomingFile } from "../imports/stagedFile";
import { downloadFromPresignedUrl } from "../api/presignedTransfer";
import {
  deleteGeoPdfImportRow,
  findGeoPdfImportBySha256,
  insertGeoPdfImport,
  listGeoPdfImports,
  updateGeoPdfImport,
  type GeoPdfImport,
  type GeoPdfImportState,
} from "./geoPdfImportsDb";

/**
 * Reject absurd files before loading them into memory (spec §2.1).
 *
 * 64 MB, not the 300 MB this used to be. `parseSourcePdf` reads the WHOLE file
 * into the Hermes heap — that is the one surviving whole-file read and there is
 * no way around it, pdf-lib needs the bytes — while an Android app heap is
 * typically 256-512 MB. A 300 MB ceiling was a number no phone can hold: it
 * bought an OOM kill where the user should have got a sentence. The measured
 * NSW 1:25 000 sheet is ~8 MB, so 64 MB is still generous, and a cap that fails
 * loudly beats a higher one that crashes.
 */
const MAX_GEOPDF_FILE_BYTES = 64 * 1024 * 1024;
/** Tiles per native call — the progress/cancel granularity (spec §4.1). */
const BATCH_SIZE = 32;

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
  FILE_TOO_LARGE: `This PDF is too large to import (${Math.round(MAX_GEOPDF_FILE_BYTES / 1024 / 1024)} MB limit).`,
  RENDER_FAILED: "Rendering this PDF failed.",
  // The planner refused before rendering: a sheet this large at this scale is
  // tens of minutes of work. It steps the zoom down first, so reaching this
  // means the georeferencing is implausible rather than the map merely big.
  TOO_MANY_TILES: "This map covers too much ground to import.",
  NO_SPACE: "There isn't enough free space on this phone for this map.",
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
  /** Tiles/bytes/seconds, once planning has worked them out. */
  estimate?: GeoPdfImportEstimate;
}

export interface GeoPdfCancelToken {
  cancelled: boolean;
}

export type GeoPdfImportOutcome =
  | { status: "imported"; record: GeoPdfImport }
  | { status: "existing"; record: GeoPdfImport }
  | { status: "paused"; record: GeoPdfImport }
  | { status: "cancelled" };

function importsRootDir(): Directory {
  return new Directory(IMPORTS_DIR, "geopdf");
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
    parserVersion: GEOPDF_PARSER_VERSION,
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
  // Size is checked once, in the staging step every entry point goes through.
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
  // Stat-then-copy: the size test used to run AFTER the full copy into
  // app-private storage, so a 2 GB share-sheet "PDF" filled the phone up before
  // being refused (see imports/stagedFile.ts).
  const staged = await stageIncomingFile({
    uri: fileUri,
    maxBytes: MAX_GEOPDF_FILE_BYTES,
    tooLargeMessage: GEOPDF_ERRORS.FILE_TOO_LARGE,
    scratchName: `geopdf-incoming-${randomId()}.pdf`,
  });
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
  const label = displayName.replace(/\.[^.]+$/, "");
  onProgress({ phase: "hashing", fraction: 0, label });
  const sha256 = await step("hash", () => LogjamPdfRenderer.sha256File(fileUri));

  const existing = await findGeoPdfImportBySha256(sha256);
  if (existing) {
    if (existing.state === "ready") return { status: "existing", record: existing };
    // Incomplete prior import of the same bytes: resume it.
    return resumeGeoPdfImport(existing.id, onProgress, token);
  }

  if (token.cancelled) return { status: "cancelled" };

  onProgress({ phase: "copying", fraction: 0, label });
  const dir = new Directory(importsRootDir(), sha256);

  // ROW FIRST, THEN THE FILE. The copy used to come first, so a process kill
  // (or a throw out of `incoming.copy`) in between left a full-size source.pdf
  // on disk with no row pointing at it: absent from Saved, absent from the
  // capacity meter, unreachable by any delete, and only ever cleared by a
  // sign-out. Nothing sweeps `imports/geopdf/`. Inserting first flips the
  // failure mode to a row whose file is missing, which the resume path already
  // reports and the user can discard.
  const record: GeoPdfImport = {
    id: randomId(),
    label,
    sha256,
    pageIndex: 0,
    viewportIndex: 0,
    state: "copying",
    errorCode: null,
    bbox: null,
    minzoom: null,
    maxzoom: null,
    residualFraction: null,
    // FULL. A GeoPDF is a map sheet the user deliberately put on top of the
    // basemap; drawing it see-through was a hedge against covering something,
    // and what it actually did was wash out the one map they asked for. The
    // column survives (a future opacity control would use it) but nothing
    // writes it any more and the map draws at 1 regardless — see MapScreen.
    opacity: 1,
    visible: true,
    dirPath: dir.uri.replace(/^file:\/\//, ""),
    sourceSizeBytes,
    quirks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await insertGeoPdfImport(record);

  if (!dir.exists) dir.create({ intermediates: true });
  const sourceFile = new File(dir, "source.pdf");
  if (sourceFile.exists) sourceFile.delete();
  await step("copy", () => incoming.copy(sourceFile));

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
  const scratchUri = await scratchFileUri(`geopdf-download-${randomId()}.pdf`);
  try {
    const result = await downloadFromPresignedUrl(downloadUrl, scratchUri);
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
  let estimate: GeoPdfImportEstimate | null = null;
  const report = (phase: GeoPdfImportState, fraction: number) =>
    onProgress({
      phase,
      fraction,
      importId: record.id,
      label: record.label,
      estimate: estimate ?? undefined,
    });
  const setState = async (state: GeoPdfImportState) => {
    await updateGeoPdfImport(record.id, { state });
    report(state, 0);
  };

  try {
    if (token.cancelled) return await pause(record);
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

    if (token.cancelled) return await pause(record);
    await setState("planning");
    const transform = buildGeoTransform(viewport);
    const clip = clipPolygonOf(viewport);
    const plan = buildTilePlan(transform, clip);

    // What this is about to cost, worked out BEFORE a tile is rendered: the
    // region downloader prices its job in tiles, bytes and minutes for exactly
    // this reason, and the GeoPDF path — the slower of the two per tile —
    // offered no number at all. `buildTilePlan` has already stepped zMax down
    // to fit MAX_GEOPDF_TILES; this reports what survived and refuses a phone
    // that cannot hold it. (The estimate rides on to the progress card.)
    estimate = estimateGeoPdfImport(plan);
    console.log(
      `[geopdf] plan z${plan.zMin}-${plan.zMax}: ${plan.tiles.length} base tiles, ~${estimate.seconds}s`,
    );
    await assertSpaceFor(estimate.bytes);

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
      // A checkpoint is only honoured when it describes THIS plan: same parser
      // version, same zMax, same tile count, cursor inside the list. `zMax`
      // alone used to be the whole test, and zMax is the LAST thing a planner
      // change moves — a resume then skipped the first nextTileIndex entries of
      // a DIFFERENT tile list and registered the holed map as ready. The rule
      // lives with the planner it validates (shared/geoPdfImport/tilePlan.ts).
      const resume = resumableFrom(
        savedState ? (JSON.parse(savedState) as GeoPdfBuildState) : null,
        plan,
      );
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
          const buildState: GeoPdfBuildState = {
            phase: "rasterising",
            zMax: plan.zMax,
            parserVersion: GEOPDF_PARSER_VERSION,
            tileCount: plan.tiles.length,
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
        const buildState: GeoPdfBuildState = {
          phase: "overviews",
          zMax: plan.zMax,
          parserVersion: GEOPDF_PARSER_VERSION,
          tileCount: plan.tiles.length,
          downsampleZ: z,
        };
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
    const code =
      err instanceof GeoPdfParseError
        ? err.code
        : err instanceof NotEnoughSpaceError
          ? "NO_SPACE"
          : "RENDER_FAILED";
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
