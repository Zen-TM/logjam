// Which MIME type a picked .gpx/.kml really is.
//
// Android's document picker reports these inconsistently — very often
// `application/octet-stream` — so the EXTENSION decides and the reported type
// is only a fallback. The API then validates the two against each other
// (`validateMediaType` in api/src/routes/media.ts), which is why the filename
// handed to `attachMediaLocal` has to keep its extension.
//
// Shared by the media strip's own picker and the canyon's "Add a way" panel:
// two copies of this is two answers to "is that a route file".
import { mediaCategory } from "@logjam/shared";

/** The track MIME for this filename, or null when it is not a route file. */
export function routeFileMimeType(
  name: string,
  reported?: string | null,
): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".gpx")) return "application/gpx+xml";
  if (lower.endsWith(".kml")) return "application/vnd.google-earth.kml+xml";
  if (reported && mediaCategory(reported) === "track") return reported;
  return null;
}
