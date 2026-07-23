// Vector file import flow (Stage 5): document picker → shared parser →
// GeoJSON file in app-private storage → vector_import row. The map renders
// rows as ShapeSources; everything works offline from the moment of import.
//
// PRIVACY: importing a file must never implicitly upload coordinates
// anywhere — the whole flow is device-local (account sync is Stage 8, opt-in
// there). Errors surfaced to the UI are the shared parser's static strings or
// generic transport messages; never file content.
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { unzipSync } from "fflate";

import { parseVectorImport, IMPORT_ERRORS } from "@logjam/shared";

import {
  deleteVectorImportRow,
  insertVectorImport,
  type VectorImport,
} from "./importsDb";

// A phone-realistic ceiling; the parser's MAX_IMPORT_POSITIONS is the real
// complexity guard, this just refuses to read absurd files into memory.
const MAX_IMPORT_FILE_BYTES = 30 * 1024 * 1024;

// Rotating default palette — high-contrast against both the paper-topo
// rasters and the Protomaps light flavor, distinct from the canyon layer's
// orange (#f97316 owned / #629bf8 shared).
const IMPORT_COLORS = [
  "#d946ef", // fuchsia
  "#10b981", // emerald
  "#eab308", // yellow
  "#8b5cf6", // violet
  "#ef4444", // red
  "#06b6d4", // cyan
];

export function pickImportColor(existingCount: number): string {
  return IMPORT_COLORS[existingCount % IMPORT_COLORS.length];
}

export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** KMZ = zip with a KML inside (canonically doc.kml). Returns the KML text. */
function kmlFromKmz(base64: string): { fileName: string; text: string } {
  let entries: Record<string, Uint8Array>;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    entries = unzipSync(bytes);
  } catch {
    throw new Error(IMPORT_ERRORS.unparseable);
  }
  const kmlName =
    Object.keys(entries).find((n) => n.toLowerCase() === "doc.kml") ??
    Object.keys(entries).find((n) => n.toLowerCase().endsWith(".kml"));
  if (!kmlName) throw new Error(IMPORT_ERRORS.unparseable);
  return {
    fileName: kmlName,
    text: new TextDecoder().decode(entries[kmlName]),
  };
}

export type ImportOutcome =
  | { status: "imported"; record: VectorImport }
  | { status: "cancelled" };

/**
 * Parse + persist a vector file already read into memory. Shared tail of the
 * picker flow and the incoming-intent ("Open in Logjam") flow.
 */
export async function importVectorSource(
  sourceUri: string,
  displayName: string,
  existingCount: number,
): Promise<VectorImport> {
  let sourceName = displayName;
  let text: string;
  if (sourceName.toLowerCase().endsWith(".kmz")) {
    const base64 = await FileSystem.readAsStringAsync(sourceUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    ({ fileName: sourceName, text } = kmlFromKmz(base64));
  } else {
    text = await FileSystem.readAsStringAsync(sourceUri);
  }

  const parsed = parseVectorImport(sourceName, text);

  const dir = `${FileSystem.documentDirectory}imports/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const id = randomId();
  const fileUri = `${dir}${id}.geojson`;
  const collection = JSON.stringify({
    type: "FeatureCollection",
    features: parsed.features,
  });
  try {
    await FileSystem.writeAsStringAsync(fileUri, collection);
    const record: VectorImport = {
      id,
      // Fall back to the file name (minus extension) when the file itself
      // is nameless.
      name: parsed.name ?? displayName.replace(/\.[^.]+$/, ""),
      color: pickImportColor(existingCount),
      visible: true,
      path: fileUri.replace(/^file:\/\//, ""),
      bbox: parsed.bbox,
      featureCount: parsed.features.length,
      positionCount: parsed.stats.positions,
      sizeBytes: collection.length,
      createdAt: new Date().toISOString(),
    };
    await insertVectorImport(record);
    return record;
  } catch (err) {
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
    throw err;
  }
}

/**
 * Run the full pick → parse → persist flow. Throws parser/storage errors
 * (static messages); returns `cancelled` when the user backs out of the
 * picker.
 */
export async function importVectorFileFromPicker(
  existingCount: number,
): Promise<ImportOutcome> {
  const picked = await DocumentPicker.getDocumentAsync({
    // GPX/KML MIME types are inconsistent across Android file providers —
    // accept everything and let the extension-dispatching parser decide.
    type: "*/*",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled || picked.assets.length === 0) {
    return { status: "cancelled" };
  }
  const asset = picked.assets[0];
  if (asset.size != null && asset.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error(IMPORT_ERRORS.tooManyPositions);
  }
  const record = await importVectorSource(asset.uri, asset.name, existingCount);
  return { status: "imported", record };
}

/** Delete an import: row + stored GeoJSON file. */
export async function deleteVectorImport(id: string): Promise<void> {
  const record = await deleteVectorImportRow(id);
  if (record) {
    await FileSystem.deleteAsync(`file://${record.path}`, {
      idempotent: true,
    }).catch(() => {});
  }
}
