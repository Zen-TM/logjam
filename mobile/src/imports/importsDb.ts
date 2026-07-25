// Vector imports registry (Stage 5): rows for user-imported GPX/KML/GeoJSON
// files. Lives in the same app-private SQLite DB as the offline map registry
// (one store, one backup-exclusion posture, one app-lock trigger).
//
// PRIVACY: imports are the user's own tracks — typically canyon-area
// coordinates. Rows/paths never reach logs, telemetry, or crash reports;
// having any import on disk arms the Stage 4 app lock (see AppLockGate).
import { getOfflineDb } from "../offline/registryDb";

export type VectorImport = {
  id: string;
  name: string;
  /** Line/point colour on the map (hex). */
  color: string;
  visible: boolean;
  /** Absolute app-private path of the stored GeoJSON, scheme-less. */
  path: string;
  bbox: [number, number, number, number];
  featureCount: number;
  positionCount: number;
  sizeBytes: number;
  createdAt: string;
};

type Listener = () => void;
const listeners = new Set<Listener>();
export function onImportsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notifyChanged(): void {
  for (const listener of listeners) listener();
}

type ImportRow = {
  id: string;
  name: string;
  color: string;
  visible: number;
  path: string;
  west: number;
  south: number;
  east: number;
  north: number;
  featureCount: number;
  positionCount: number;
  sizeBytes: number;
  createdAt: string;
};

function rowToImport(row: ImportRow): VectorImport {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    visible: row.visible !== 0,
    path: row.path,
    bbox: [row.west, row.south, row.east, row.north],
    featureCount: row.featureCount,
    positionCount: row.positionCount,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  };
}

export async function listVectorImports(): Promise<VectorImport[]> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<ImportRow>(
    "SELECT * FROM vector_import ORDER BY createdAt DESC",
  );
  return rows.map(rowToImport);
}

export async function insertVectorImport(record: VectorImport): Promise<void> {
  const db = await getOfflineDb();
  await db.runAsync(
    `INSERT INTO vector_import
       (id, name, color, visible, path, west, south, east, north,
        featureCount, positionCount, sizeBytes, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.id,
    record.name,
    record.color,
    record.visible ? 1 : 0,
    record.path,
    record.bbox[0],
    record.bbox[1],
    record.bbox[2],
    record.bbox[3],
    record.featureCount,
    record.positionCount,
    record.sizeBytes,
    record.createdAt,
  );
  notifyChanged();
}

export async function setVectorImportVisible(
  id: string,
  visible: boolean,
): Promise<void> {
  const db = await getOfflineDb();
  await db.runAsync(
    "UPDATE vector_import SET visible = ? WHERE id = ?",
    visible ? 1 : 0,
    id,
  );
  notifyChanged();
}

export async function renameVectorImport(id: string, name: string): Promise<void> {
  const db = await getOfflineDb();
  await db.runAsync("UPDATE vector_import SET name = ? WHERE id = ?", name, id);
  notifyChanged();
}

export async function deleteVectorImportRow(
  id: string,
): Promise<VectorImport | null> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<ImportRow>(
    "SELECT * FROM vector_import WHERE id = ?",
    id,
  );
  if (rows.length === 0) return null;
  await db.runAsync("DELETE FROM vector_import WHERE id = ?", id);
  notifyChanged();
  return rowToImport(rows[0]);
}
