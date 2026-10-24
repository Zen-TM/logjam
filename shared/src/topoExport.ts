// An export row as clients see it: an export of an area (`areaExport.ts`), or,
// until its 7 days run out, an older export of a LiDAR topo.

import type { TopoLayerKey } from "./topoSettings.js";
import type { AreaBbox } from "./areaExport.js";

/** Every format an export row can carry: the area formats, plus GeoJSON and
 *  GPX from older exports of a topo, still listed until they expire. */
export type ExportFormat = "mbtiles" | "geotiff" | "gpkg" | "geojson" | "gpx";

export type ExportBundling = "composite" | "per-layer";

export type ExportStatus = "queued" | "running" | "completed" | "failed";

/** What each format is called, wherever an export is named. */
export const EXPORT_FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
  mbtiles: "MBTiles",
  geotiff: "GeoTIFF",
  gpkg: "GeoPackage",
  geojson: "GeoJSON",
  gpx: "GPX",
};

// Server-side type for a TopoExportJob row returned to the client. Mirrors
// the Prisma model but with serializable dates and the BigInt cast away.
export interface TopoExportJobView {
  id: string;
  sourceJobIds: string[];
  layers: TopoLayerKey[];
  format: ExportFormat;
  bundling: ExportBundling;
  status: ExportStatus;
  // Adaptive processing-time estimate (seconds) computed at create. Null on
  // rows created before the estimator existed or when the source tile count
  // was unknown — display falls back to a static "Exporting…" label.
  estimatedSeconds: number | null;
  resultBytes: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  /** An export of an area: its box. Null for an export of a topo. */
  bbox: AreaBbox | null;
  downloadUrl: string | null; // presigned, set only when status=completed
  downloadExpiresAt: string | null;
}
