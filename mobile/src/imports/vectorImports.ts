// Vector file import flow (Stage 5): document picker → shared parser →
// GeoJSON file in app-private storage → vector_import row. The map renders
// rows as GeoJSON sources; everything works offline from the moment of import.
//
// PRIVACY: importing a file must never implicitly upload coordinates
// anywhere — the whole flow is device-local (account sync is Stage 8, opt-in
// there). Errors surfaced to the UI are the shared parser's static strings or
// generic transport messages; never file content.
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { File } from "expo-file-system";
import { unzipSync } from "fflate";

import { parseVectorImport, IMPORT_ERRORS, pickTrackColorByIndex } from "@logjam/shared";

import {
  deleteVectorImportRow,
  insertVectorImport,
  type VectorImport,
} from "./importsDb";
import { IMPORTS_DIR } from "../offline/localStores";
import { stageIncomingFile } from "./stagedFile";

// A phone-realistic ceiling; the parser's MAX_IMPORT_POSITIONS is the real
// complexity guard, this just refuses to read absurd files into memory.
const MAX_IMPORT_FILE_BYTES = 30 * 1024 * 1024;

export function pickImportColor(existingCount: number): string {
  return pickTrackColorByIndex(existingCount);
}

export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// A KMZ may not expand past what a bare .kml import is allowed to be. The
// ceiling above is checked against the COMPRESSED file, so without this a 30 MB
// zip of zeroes inflates to gigabytes — on the one input path an outside party
// controls, and before any downstream guard (MAX_IMPORT_POSITIONS) gets to run.
const MAX_KMZ_UNCOMPRESSED_BYTES = MAX_IMPORT_FILE_BYTES;

/**
 * KMZ = zip with a KML inside (canonically doc.kml). Returns the KML text.
 *
 * Takes BYTES, not base64. It used to read the file as a base64 string and
 * decode it with `for (i…) bytes[i] = binary.charCodeAt(i)` — the per-byte JS
 * loop the GeoPDF work was written to eliminate. Hermes has no JIT, so that
 * costs ~70× what it profiles at on a laptop: a 20 MB KMZ froze the UI thread
 * for seconds with nothing on screen. `new File(uri).bytes()` is native.
 *
 * TWO PASSES, and the first one inflates nothing. A bare `unzipSync(bytes)`
 * eagerly inflates EVERY entry — icons, overlays, and a hostile 10000:1 entry
 * alike — into JS memory before our first line runs. fflate's `filter` is
 * called with the central-directory record before any inflation, and it sizes
 * the output buffer from that same declared `originalSize`, so refusing there
 * is a real cap: a record that lies high is refused, one that lies low
 * truncates into an unparseable KML rather than growing the buffer.
 */
export function kmlFromKmz(bytes: Uint8Array): { fileName: string; text: string } {
  const declared: { name: string; originalSize: number }[] = [];
  try {
    unzipSync(bytes, {
      filter: ({ name, originalSize }) => {
        declared.push({ name, originalSize });
        return false; // listing pass only
      },
    });
  } catch {
    throw new Error(IMPORT_ERRORS.unparseable);
  }
  const entry =
    declared.find((e) => e.name.toLowerCase() === "doc.kml") ??
    declared.find((e) => e.name.toLowerCase().endsWith(".kml"));
  if (!entry) throw new Error(IMPORT_ERRORS.unparseable);
  if (entry.originalSize > MAX_KMZ_UNCOMPRESSED_BYTES) {
    throw new Error(IMPORT_ERRORS.tooLarge);
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: ({ name }) => name === entry.name });
  } catch {
    throw new Error(IMPORT_ERRORS.unparseable);
  }
  const inflated = entries[entry.name];
  if (!inflated) throw new Error(IMPORT_ERRORS.unparseable);
  return { fileName: entry.name, text: new TextDecoder().decode(inflated) };
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
  /** Friend this file arrived from, when it came in through "Send a copy". */
  sentBy: string | null = null,
): Promise<VectorImport> {
  // THE SIZE CHECK LIVES HERE, not in the picker. `importVectorFileFromPicker`
  // was the only caller that checked, and the share sheet ("Open in Logjam")
  // calls this one directly — so a large or hostile `.geojson` went straight
  // into `readAsStringAsync`, i.e. the whole file into one JS string, and OOM
  // -killed the app before any guard fired. It is also the one input path an
  // outside party controls. Staging additionally gives the KMZ reader a real
  // file to take bytes from (share-sheet URIs are `content://`).
  const staged = await stageIncomingFile({
    uri: sourceUri,
    maxBytes: MAX_IMPORT_FILE_BYTES,
    tooLargeMessage: IMPORT_ERRORS.tooLarge,
    scratchName: `vector-incoming-${randomId()}`,
  });
  try {
    return await parseAndStore(staged.uri, displayName, existingCount, sentBy);
  } finally {
    if (staged.scratch) {
      await FileSystem.deleteAsync(staged.scratch, { idempotent: true }).catch(
        () => {},
      );
    }
  }
}

async function parseAndStore(
  sourceUri: string,
  displayName: string,
  existingCount: number,
  sentBy: string | null,
): Promise<VectorImport> {
  let sourceName = displayName;
  let text: string;
  if (sourceName.toLowerCase().endsWith(".kmz")) {
    ({ fileName: sourceName, text } = kmlFromKmz(new File(sourceUri).bytesSync()));
  } else {
    text = await FileSystem.readAsStringAsync(sourceUri);
  }

  const parsed = parseVectorImport(sourceName, text);

  const dir = IMPORTS_DIR;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const id = randomId();
  const fileUri = `${dir}${id}.geojson`;
  const sourceUriStored = `${dir}${id}-source.${sourceExtension(sourceName)}`;
  const collection = JSON.stringify({
    type: "FeatureCollection",
    features: parsed.features,
  });
  try {
    await FileSystem.writeAsStringAsync(fileUri, collection);
    // The picked file, kept verbatim beside its derivation. `text` rather than
    // a copy of `sourceUri` so a KMZ lands as the KML it contains: the staged
    // original is a zip, `writeAsStringAsync` is UTF-8, and the app has never
    // read a KMZ's bundled assets anyway — so the text it parsed IS the most
    // faithful original it can honestly offer.
    // ponytail: text-only. A KMZ's icons/overlays are dropped, as they always
    // were; keeping the zip needs a binary-safe SAF write, do it when someone
    // asks for those assets back.
    await FileSystem.writeAsStringAsync(sourceUriStored, text);
    const record: VectorImport = {
      id,
      // Fall back to the file name (minus extension) when the file itself
      // is nameless.
      name: parsed.name ?? displayName.replace(/\.[^.]+$/, ""),
      color: pickImportColor(existingCount),
      visible: true,
      path: fileUri.replace(/^file:\/\//, ""),
      sourcePath: sourceUriStored.replace(/^file:\/\//, ""),
      sentBy,
      bbox: parsed.bbox,
      featureCount: parsed.features.length,
      positionCount: parsed.stats.positions,
      // Both files are on the device, so both count against the Saved tab's
      // capacity meter — reporting only the GeoJSON would under-report by
      // roughly the size of the file the user picked.
      sizeBytes: collection.length + text.length,
      createdAt: new Date().toISOString(),
    };
    await insertVectorImport(record);
    return record;
  } catch (err) {
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
    await FileSystem.deleteAsync(sourceUriStored, { idempotent: true }).catch(
      () => {},
    );
    throw err;
  }
}

/**
 * The stored original's extension: the picked file's own, narrowed to the
 * three the parser accepts so nothing user-supplied reaches a filesystem path.
 * A KMZ is stored as the KML extracted from it (see parseAndStore).
 */
function sourceExtension(sourceName: string): "gpx" | "kml" | "geojson" {
  const lower = sourceName.toLowerCase();
  if (lower.endsWith(".gpx")) return "gpx";
  if (lower.endsWith(".kml") || lower.endsWith(".kmz")) return "kml";
  return "geojson";
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
  const record = await importVectorSource(asset.uri, asset.name, existingCount);
  return { status: "imported", record };
}

/** Delete an import: row + stored GeoJSON + the original it was derived from. */
export async function deleteVectorImport(id: string): Promise<void> {
  const record = await deleteVectorImportRow(id);
  if (!record) return;
  for (const path of [record.path, record.sourcePath]) {
    if (!path) continue;
    await FileSystem.deleteAsync(`file://${path}`, {
      idempotent: true,
    }).catch(() => {});
  }
}
