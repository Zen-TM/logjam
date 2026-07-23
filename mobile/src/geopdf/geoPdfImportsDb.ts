// GeoPDF imports registry (Stage 6): rows for user-imported GeoPDF maps,
// tiled on-device into MBTiles. Same app-private SQLite DB as the offline
// registry (one store, one backup-exclusion posture, one app-lock trigger).
//
// PRIVACY: a Logjam-exported GeoPDF carries canyon overlays; the source PDF,
// tiles and this row are app-private, backup-excluded, and arm the Stage 4
// app lock. Labels/paths/bounds never reach logs, telemetry or crash
// reports — pipeline logging is state transitions and error CODES only.
import { getOfflineDb } from "../offline/registryDb";

export type GeoPdfImportState =
  | "copying"
  | "hashing"
  | "parsing"
  | "planning"
  | "rasterising"
  | "overviews"
  | "finalising"
  | "ready"
  | "failed";

export type GeoPdfImport = {
  id: string;
  label: string;
  sha256: string;
  pageIndex: number;
  viewportIndex: number;
  state: GeoPdfImportState;
  /** GeoPdfParseError code (or pipeline code) when state === "failed". */
  errorCode: string | null;
  bbox: [number, number, number, number] | null;
  minzoom: number | null;
  maxzoom: number | null;
  /** maxResidualFractionOfWidth — > RESIDUAL_WARN_FRACTION shows a warning. */
  residualFraction: number | null;
  opacity: number;
  visible: boolean;
  /** App-private dir holding source.pdf + tiles.mbtiles, scheme-less. */
  dirPath: string;
  sourceSizeBytes: number;
  /** Parser quirk ids (diagnostics, shown in-app only). */
  quirks: string[];
  createdAt: string;
  updatedAt: string;
};

type Listener = () => void;
const listeners = new Set<Listener>();
export function onGeoPdfImportsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notifyChanged(): void {
  for (const listener of listeners) listener();
}

type GeoPdfRow = {
  id: string;
  label: string;
  sha256: string;
  pageIndex: number;
  viewportIndex: number;
  state: string;
  errorCode: string | null;
  west: number | null;
  south: number | null;
  east: number | null;
  north: number | null;
  minzoom: number | null;
  maxzoom: number | null;
  residualFraction: number | null;
  opacity: number;
  visible: number;
  dirPath: string;
  sourceSizeBytes: number;
  quirks: string | null;
  createdAt: string;
  updatedAt: string;
};

function rowToImport(row: GeoPdfRow): GeoPdfImport {
  return {
    id: row.id,
    label: row.label,
    sha256: row.sha256,
    pageIndex: row.pageIndex,
    viewportIndex: row.viewportIndex,
    state: row.state as GeoPdfImportState,
    errorCode: row.errorCode,
    bbox:
      row.west != null && row.south != null && row.east != null && row.north != null
        ? [row.west, row.south, row.east, row.north]
        : null,
    minzoom: row.minzoom,
    maxzoom: row.maxzoom,
    residualFraction: row.residualFraction,
    opacity: row.opacity,
    visible: row.visible !== 0,
    dirPath: row.dirPath,
    sourceSizeBytes: row.sourceSizeBytes,
    quirks: row.quirks ? (JSON.parse(row.quirks) as string[]) : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listGeoPdfImports(): Promise<GeoPdfImport[]> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<GeoPdfRow>(
    "SELECT * FROM geo_pdf_import ORDER BY createdAt DESC",
  );
  return rows.map(rowToImport);
}

export async function findGeoPdfImportBySha256(
  sha256: string,
): Promise<GeoPdfImport | null> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<GeoPdfRow>(
    "SELECT * FROM geo_pdf_import WHERE sha256 = ?",
    sha256,
  );
  return rows.length > 0 ? rowToImport(rows[0]) : null;
}

export async function insertGeoPdfImport(record: GeoPdfImport): Promise<void> {
  const db = await getOfflineDb();
  await db.runAsync(
    `INSERT INTO geo_pdf_import
       (id, label, sha256, pageIndex, viewportIndex, state, errorCode,
        west, south, east, north, minzoom, maxzoom, residualFraction,
        opacity, visible, dirPath, sourceSizeBytes, quirks, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.id,
    record.label,
    record.sha256,
    record.pageIndex,
    record.viewportIndex,
    record.state,
    record.errorCode,
    record.bbox?.[0] ?? null,
    record.bbox?.[1] ?? null,
    record.bbox?.[2] ?? null,
    record.bbox?.[3] ?? null,
    record.minzoom,
    record.maxzoom,
    record.residualFraction,
    record.opacity,
    record.visible ? 1 : 0,
    record.dirPath,
    record.sourceSizeBytes,
    JSON.stringify(record.quirks),
    record.createdAt,
    record.updatedAt,
  );
  notifyChanged();
}

/** Partial update; always bumps updatedAt and notifies. */
export async function updateGeoPdfImport(
  id: string,
  patch: Partial<
    Pick<
      GeoPdfImport,
      | "label"
      | "state"
      | "errorCode"
      | "bbox"
      | "minzoom"
      | "maxzoom"
      | "residualFraction"
      | "opacity"
      | "visible"
      | "quirks"
    >
  >,
): Promise<void> {
  const db = await getOfflineDb();
  const sets: string[] = ["updatedAt = ?"];
  const args: (string | number | null)[] = [new Date().toISOString()];
  if (patch.label !== undefined) {
    sets.push("label = ?");
    args.push(patch.label);
  }
  if (patch.state !== undefined) {
    sets.push("state = ?");
    args.push(patch.state);
  }
  if (patch.errorCode !== undefined) {
    sets.push("errorCode = ?");
    args.push(patch.errorCode);
  }
  if (patch.bbox !== undefined) {
    sets.push("west = ?, south = ?, east = ?, north = ?");
    if (patch.bbox) args.push(patch.bbox[0], patch.bbox[1], patch.bbox[2], patch.bbox[3]);
    else args.push(null, null, null, null);
  }
  if (patch.minzoom !== undefined) {
    sets.push("minzoom = ?");
    args.push(patch.minzoom);
  }
  if (patch.maxzoom !== undefined) {
    sets.push("maxzoom = ?");
    args.push(patch.maxzoom);
  }
  if (patch.residualFraction !== undefined) {
    sets.push("residualFraction = ?");
    args.push(patch.residualFraction);
  }
  if (patch.opacity !== undefined) {
    sets.push("opacity = ?");
    args.push(patch.opacity);
  }
  if (patch.visible !== undefined) {
    sets.push("visible = ?");
    args.push(patch.visible ? 1 : 0);
  }
  if (patch.quirks !== undefined) {
    sets.push("quirks = ?");
    args.push(JSON.stringify(patch.quirks));
  }
  await db.runAsync(
    `UPDATE geo_pdf_import SET ${sets.join(", ")} WHERE id = ?`,
    ...args,
    id,
  );
  notifyChanged();
}

export async function deleteGeoPdfImportRow(
  id: string,
): Promise<GeoPdfImport | null> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<GeoPdfRow>(
    "SELECT * FROM geo_pdf_import WHERE id = ?",
    id,
  );
  if (rows.length === 0) return null;
  await db.runAsync("DELETE FROM geo_pdf_import WHERE id = ?", id);
  notifyChanged();
  return rowToImport(rows[0]);
}
