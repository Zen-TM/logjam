// Save a way — a route or a recorded track — out of Logjam GPS as GPX or KML,
// or hand back an imported file exactly as it arrived.
//
// Serialisation is shared (shared/src/routeExport.ts for an authored route,
// shared/src/trackExport.ts for a recording) so the file a phone writes is
// byte-identical to the one the web downloads. Only the "where does it go"
// part is per-platform, and that is all this file is — which is why it sits
// here rather than under routes/ or tracks/: both own a caller, neither owns
// the writing.
//
// ANDROID uses the Storage Access Framework through expo-file-system's
// Directory API: the user picks a real folder, we write into it, and the file
// lands somewhere they can find with any file manager. Not the legacy
// StorageAccessFramework helpers: they accept only com.android.externalstorage
// trees, so a phone whose picker offers just Downloads (or Drive) rejects a
// valid grant. Guard: fileExport.test.ts. No new native module — expo-sharing
// would mean a fresh dev client build for what SAF already does.
//
// iOS has no SAF equivalent, so export fails loudly there rather than
// pretending. It needs expo-sharing (share sheet, whose "Save to Files" is the
// iOS answer to a folder picker), which is a native dependency and a rebuild —
// a deliberate follow-up, not a silent no-op. When it lands it goes in
// saveExportFile alone and both callers get it at once.
//
// PRIVACY: the written file IS the line through a place, and for a recording
// it is precise timestamped location history. It goes only to the folder the
// user chose; nothing here logs the name, the path, or the geometry.
import { Platform } from "react-native";
import { Directory } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import {
  exportFilename,
  GEOJSON_MIME_TYPE,
  GPX_MIME_TYPE,
  KML_MIME_TYPE,
  routeToGpx,
  routeToKml,
  trackPointsToGpx,
  trackPointsToKml,
  type RecordedTrackPoint,
  type RoutePoint,
} from "@logjam/shared";

// Directory.pickDirectoryAsync rejects with this code when the user backs out.
const PICKER_CANCELLED = "ERR_PICKER_CANCELLED";

export type ExportFormat = "gpx" | "kml";

/** Thrown when the platform can't save a file at all — the caller says so. */
export class ExportUnsupportedError extends Error {
  constructor() {
    super("Saving files isn't supported on this device yet.");
    this.name = "ExportUnsupportedError";
  }
}

/**
 * Write one file to a folder the user picks.
 *
 * Returns the filename actually used on success, or null when the user backed
 * out of the folder picker — a cancel is not a failure and must not raise an
 * error the caller shows as one.
 */
async function saveExportFile(
  filename: string,
  content: string,
  mimeType: string,
): Promise<string | null> {
  if (Platform.OS !== "android") throw new ExportUnsupportedError();

  let directory: Directory;
  try {
    directory = await Directory.pickDirectoryAsync();
  } catch (err) {
    if ((err as { code?: string }).code === PICKER_CANCELLED) return null;
    throw err;
  }

  // Android's own collision handling appends its counter to the END of the
  // display name — "route.gpx (1)" — which leaves the file without a usable
  // extension and Gaia refuses it. So the collision is resolved HERE, where the
  // counter can go before the dot, and SAF is only ever handed a free name.
  const taken = new Set(directory.list().map((entry) => entry.name));
  const extension = filename.slice(filename.lastIndexOf(".") + 1);
  const base = filename.slice(0, filename.lastIndexOf("."));
  let candidate = filename;
  for (let n = 1; taken.has(candidate) && n < 100; n++) {
    candidate = `${base} (${n}).${extension}`;
  }

  await directory.createFile(candidate, mimeType).write(content);
  return candidate;
}

const mimeTypeFor = (format: ExportFormat) =>
  format === "gpx" ? GPX_MIME_TYPE : KML_MIME_TYPE;

/** An authored route: `<rte>` / `<LineString>`, no timestamps. */
export async function exportRoute(
  route: { name: string; points: RoutePoint[] },
  format: ExportFormat,
): Promise<string | null> {
  const content =
    format === "gpx"
      ? routeToGpx(route.name, route.points)
      : routeToKml(route.name, route.points);
  return saveExportFile(
    exportFilename(route.name, format),
    content,
    mimeTypeFor(format),
  );
}

/**
 * A file already on the device, written back out unchanged.
 *
 * The import path's reason for existing: an imported GPX's GeoJSON is a LOSSY
 * derivation, so handing one back as "your file" would quietly drop the
 * descriptions, symbols, extensions and rte/trk distinction the user gave us.
 * The bytes go out as they came in.
 */
export async function exportStoredFile(
  storedPath: string,
  filename: string,
): Promise<string | null> {
  const content = await FileSystem.readAsStringAsync(`file://${storedPath}`);
  return saveExportFile(filename, content, mimeTypeForFilename(filename));
}

const mimeTypeForFilename = (filename: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".gpx")) return GPX_MIME_TYPE;
  if (lower.endsWith(".kml")) return KML_MIME_TYPE;
  return GEOJSON_MIME_TYPE;
};

/** A recording: `<trk>` / `<gx:Track>`, timestamps and pause gaps preserved. */
export async function exportTrack(
  track: { name: string; points: RecordedTrackPoint[] },
  format: ExportFormat,
): Promise<string | null> {
  const content =
    format === "gpx"
      ? trackPointsToGpx(track.name, track.points)
      : trackPointsToKml(track.name, track.points);
  return saveExportFile(
    exportFilename(track.name, format, "track"),
    content,
    mimeTypeFor(format),
  );
}
