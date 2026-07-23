import { NativeModule, requireNativeModule } from "expo";

import type { TileJob } from "@logjam/shared/dist/geoPdfImport/tilePlan.js";

// Stage 6 native rasteriser contract (stage6-geopdf.md §4.1). All pixel work
// (render, warp, PNG encode, SQLite insert) happens natively; JS sends warp
// specs and receives counts. Android implementation is authoritative
// (PdfRenderer-backed); the iOS side still carries the Stage 0 spike surface
// and is rebuilt when iOS work starts (no local iOS toolchain on this host).

export interface PdfPageInfo {
  widthPt: number;
  heightPt: number;
}

export interface OpenPdfResult {
  handle: number;
  pageCount: number;
  pages: PdfPageInfo[];
}

export interface PageRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RasteriseBatchOptions {
  page: number;
  mbtilesUri: string;
  tileSize: 256 | 512;
  /**
   * Neatline (page pts). ALWAYS pass it (viewport BBox when no /Bounds):
   * edge tiles render on a white backdrop and only the clip path makes the
   * outside transparent.
   */
  clipPolygonPt?: { x: number; y: number }[];
  /** ≤ 32 per call — the batch is the progress/cancel granularity. */
  tiles: TileJob[];
  /** JSON checkpoint stored to metadata logjam:build_state in-transaction. */
  buildState?: string;
}

declare class LogjamPdfRendererModule extends NativeModule {
  open(fileUri: string): Promise<OpenPdfResult>;
  close(handle: number): Promise<void>;

  /** Render a page region (PDF pts, origin bottom-left) to a PNG file. */
  renderRegion(
    handle: number,
    pageIndex: number,
    rect: PageRect,
    outPxWidth: number,
    outPxHeight: number,
    outFileUri: string,
  ): Promise<void>;

  createMbtiles(fileUri: string, metadata: Record<string, string>): Promise<void>;
  rasteriseBatch(
    handle: number,
    options: RasteriseBatchOptions,
  ): Promise<{ written: number }>;
  /** Downsample fromZ → fromZ−1 (4 children → 1 parent, bilinear 50 %). */
  downsampleLevel(
    mbtilesUri: string,
    fromZ: number,
    tileSize: 256 | 512,
    buildState: string | null,
  ): Promise<{ written: number }>;
  /** Write final metadata, drop logjam:build_state, WAL → DELETE journal. */
  finalizeMbtiles(fileUri: string, metadata: Record<string, string>): Promise<void>;
  /** Read one metadata value (null when absent) — resume reads build_state. */
  readMbtilesMetadata(fileUri: string, key: string): Promise<string | null>;
}

export default requireNativeModule<LogjamPdfRendererModule>("LogjamPdfRenderer");
