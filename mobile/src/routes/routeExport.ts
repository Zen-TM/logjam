// Save a route out of the app as GPX or KML.
//
// Serialisation is shared (shared/src/routeExport.ts) so the file a phone
// writes is byte-identical to the one the web downloads. Only the "where does
// it go" part is per-platform, and that is all this file is.
//
// ANDROID uses the Storage Access Framework, which is already part of
// expo-file-system: the user picks a real folder, we write into it, and the
// file lands somewhere they can find with any file manager. No new native
// module — expo-sharing would mean a config-plugin change and a fresh dev
// client build for what SAF already does.
//
// iOS has no SAF equivalent, so export fails loudly there rather than
// pretending. It needs expo-sharing (share sheet), which is a native dependency
// and a rebuild — a deliberate follow-up, not a silent no-op.
//
// PRIVACY: the written file IS the line through a canyon. It goes only to the
// folder the user chose; nothing here logs the name, the path, or the
// geometry.
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import {
  GPX_MIME_TYPE,
  KML_MIME_TYPE,
  routeExportFilename,
  routeToGpx,
  routeToKml,
  type RoutePoint,
} from "@logjam/shared";

export type RouteExportFormat = "gpx" | "kml";

/** Thrown when the platform can't save a file at all — the caller says so. */
export class RouteExportUnsupportedError extends Error {
  constructor() {
    super("Saving files isn't supported on this device yet.");
    this.name = "RouteExportUnsupportedError";
  }
}

/**
 * Write the route to a folder the user picks.
 *
 * Returns the chosen filename on success, or null when the user backed out of
 * the folder picker — a cancel is not a failure and must not raise an error
 * the caller shows as one.
 */
export async function exportRoute(
  route: { name: string; points: RoutePoint[] },
  format: RouteExportFormat,
): Promise<string | null> {
  if (Platform.OS !== "android") throw new RouteExportUnsupportedError();

  const filename = routeExportFilename(route.name, format);
  const content =
    format === "gpx"
      ? routeToGpx(route.name, route.points)
      : routeToKml(route.name, route.points);
  const mimeType = format === "gpx" ? GPX_MIME_TYPE : KML_MIME_TYPE;

  const permission =
    await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;

  // createFileAsync appends the extension itself from the mime type, so it is
  // handed the BASE name — passing "route.gpx" yields "route.gpx.gpx".
  const target = await FileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    filename.replace(/\.(gpx|kml)$/, ""),
    mimeType,
  );
  await FileSystem.writeAsStringAsync(target, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return filename;
}
