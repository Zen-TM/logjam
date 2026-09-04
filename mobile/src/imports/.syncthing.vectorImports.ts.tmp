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

import {
  parseVectorImport,
  IMPORT_ERRORS,
  pickTrackColorByIndex,
  MEDIA_EXTENSION_BY_MIME,
  TRACK_MIME_TYPES,
} from "@logjam/shared";

import {
  deleteImportViewState,
  getVectorImport,
  upsertImportViewState,
  type VectorImport,
} from "./importsDb";
import {
  createStandaloneMediaLocal,
  deleteMediaLocal,
} from "../sync/mediaUpload";
import { getMediaById } from "../sync/mirrorStore";
import { ensureDisplayCached } from "../sync/mediaCache";
import { IMPORTS_DIR } from "../offline/localStores";
import { importDisplayName } from "./importName";
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
  // A staging id for the two files. The row's real identity is the media id,
  // minted by createStandaloneMediaLocal below — the files are named from this
  // one because they have to exist before there is a row to name them after.
  const id = randomId();
  const fileUri = `${dir}${id}.geojson`;
  const format = sourceExtension(sourceName);
  const sourceUriStored = `${dir}${id}-source.${format}`;
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

    // The ORIGINAL is what uploads, never the GeoJSON beside it: the
    // derivation is lossy (only `name` and `coordTimes` survive), so a second
    // device rebuilding from it would hold strictly less than this one does.
    // The GeoJSON stays a local convenience, re-derivable from the bytes.
    const name = importDisplayName({
      contentName: parsed.name ?? null,
      filename: displayName,
      sentBy,
    });
    const mediaId = await createStandaloneMediaLocal({
      filePath: sourceUriStored,
      filename: `${name}.${format}`,
      mediaType: MIME_BY_FORMAT[format],
      origin: "import",
      displayName: name,
      // A local guess so the line draws before the upload lands; the server
      // reassigns authoritatively at confirm (see finalizeConfirmed).
      color: pickImportColor(existingCount),
      metadata: {
        bbox: parsed.bbox,
        featureCount: parsed.features.length,
        positionCount: parsed.stats.positions,
      },
    });
    await upsertImportViewState({
      mediaId,
      visible: true,
      path: fileUri.replace(/^file:\/\//, ""),
      sourcePath: sourceUriStored.replace(/^file:\/\//, ""),
      sentBy,
    });
    const record = await getVectorImport(mediaId);
    if (!record) throw new Error("Import row vanished immediately after writing it");
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
 * Extension → MIME, inverted from the shared table rather than restated: two
 * lists that must agree are one declaration (root CLAUDE.md). A format the
 * server does not accept cannot appear here, because it would have no entry.
 */
const MIME_BY_FORMAT: Record<"gpx" | "kml" | "geojson", string> = Object.fromEntries(
  TRACK_MIME_TYPES.map((mime) => [MEDIA_EXTENSION_BY_MIME[mime], mime]),
) as Record<"gpx" | "kml" | "geojson", string>;

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

/**
 * Make sure an import's bytes are on THIS phone, deriving the GeoJSON the map
 * draws from.
 *
 * A file imported on another device arrives as a row long before its bytes do
 * (§7.3: rows sync eagerly, blobs are fetched on demand), so this is the step
 * between "it is in your list" and "it is on your map". Returns the GeoJSON
 * path, or null when the file could not be fetched — offline, most often,
 * which is not an error worth a dialog on a screen full of other files.
 *
 * Idempotent and safe to call on every render pass: it short-circuits the
 * moment the derived file exists.
 */
export async function ensureImportOnDevice(mediaId: string): Promise<string | null> {
  const existing = await getVectorImport(mediaId);
  if (!existing) return null;
  if (existing.path) {
    const info = await FileSystem.getInfoAsync(`file://${existing.path}`);
    if (info.exists) return existing.path;
  }

  // The ORIGINAL is the media blob; the GeoJSON is derived from it here, the
  // same way the importing device derived its own.
  const sourceUri = await ensureDisplayCached(mediaId);
  if (!sourceUri) return null;

  const media = await getMediaById(mediaId);
  if (!media) return null;
  const text = await FileSystem.readAsStringAsync(sourceUri);
  const parsed = parseVectorImport(media.filename ?? "import.geojson", text);

  await FileSystem.makeDirectoryAsync(IMPORTS_DIR, { intermediates: true });
  const fileUri = `${IMPORTS_DIR}${mediaId}.geojson`;
  await FileSystem.writeAsStringAsync(
    fileUri,
    JSON.stringify({ type: "FeatureCollection", features: parsed.features }),
  );
  const path = fileUri.replace(/^file:\/\//, "");
  await upsertImportViewState({
    mediaId,
    visible: existing.visible,
    path,
    sourcePath: sourceUri.replace(/^file:\/\//, ""),
    sentBy: existing.sentBy,
  });
  return path;
}

/**
 * Delete an import everywhere: the media row (which syncs, so it goes from
 * every device), this phone's view state, and the derived GeoJSON.
 *
 * The ORIGINAL is not deleted here — it is the media row's cached blob, and
 * `deleteMediaLocal`'s op owns unlinking it along with the server row. Deleting
 * it twice is harmless; deleting it here and then failing to delete the row
 * would leave an upload pointing at bytes that are gone.
 */
export async function deleteVectorImport(id: string): Promise<void> {
  const media = await getMediaById(id);
  const view = await deleteImportViewState(id);
  if (media) await deleteMediaLocal(media);
  if (view?.path) {
    await FileSystem.deleteAsync(`file://${view.path}`, {
      idempotent: true,
    }).catch(() => {});
  }
}
