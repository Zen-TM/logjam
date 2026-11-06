// Importing a file of lines (GPX, KML, GeoJSON) as a Way of kind Import.
//
// The same row Logjam GPS's Saved screen makes: the original file is stored
// untouched as a standalone `import`, and the parse only supplies its name and
// the bounds the list and map need. Parse errors are the parser's static
// strings, so nothing here carries a filename or a coordinate to a log.
import {
  IMPORT_ERRORS,
  importDisplayName,
  MEDIA_SIZE_CAPS,
  parseVectorImport,
} from "@logjam/shared";
import { uploadMedia } from "../../../placeUtils";
import { resolveMediaType } from "../../media/mediaFiles";

/** What the file picker offers: the formats `parseVectorImport` reads. */
export const WAY_IMPORT_ACCEPT = ".gpx,.kml,.geojson";

/** Resolves to the name the import goes by in Ways. */
export async function importWayFile(file: File): Promise<string> {
  const resolved = resolveMediaType(file);
  if (resolved?.category !== "track") {
    throw new Error(IMPORT_ERRORS.unsupportedExtension);
  }
  if (file.size > MEDIA_SIZE_CAPS.track)
    throw new Error(IMPORT_ERRORS.tooLarge);

  const parsed = parseVectorImport(file.name, await file.text());
  const name = importDisplayName({
    contentName: parsed.name,
    filename: file.name,
    sentBy: null,
  });
  await uploadMedia({
    linkedType: "none",
    linkedId: null,
    origin: "import",
    displayName: name,
    metadata: {
      bbox: parsed.bbox,
      featureCount: parsed.features.length,
      positionCount: parsed.stats.positions,
    },
    file,
    mediaType: resolved.mediaType,
    thumbnail: null,
  });
  return name;
}
