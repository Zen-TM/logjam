import {
  buildPlaceExport as buildPlaceExportFile,
  type TExportFormat,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import type { TPlace } from "./placeUtils";

export type { TExportFormat };

// The builder is shared (shared/src/placeExport.ts), so a file leaves Logjam
// Web and Logjam GPS alike; here it only becomes a Blob for the download.
export function buildPlaceExport(
  places: TPlace[],
  format: TExportFormat,
  defs: TripLogCustomFieldDef[] = [],
): { blob: Blob; filename: string } {
  const { content, mimeType, filename } = buildPlaceExportFile(
    places,
    format,
    defs,
  );
  return { blob: new Blob([content], { type: mimeType }), filename };
}
