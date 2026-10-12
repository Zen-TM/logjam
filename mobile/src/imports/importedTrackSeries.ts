// An imported file's lines, as a track series the shared stats engine can read.
//
// The point of this file is that an imported GPX and a recording made on this
// phone are the same object: both are a line someone walked, and both deserve
// the same panel (DESIGN.md). What differs is what the file carried —
// a `<time>` on every trkpt buys moving time and pace, its absence leaves
// distance and climb, and `computeTrackDetail` already draws that line.
//
// Only LINES are read. A file of waypoints has no distance to report, and a
// polygon's perimeter is not a walk.
//
// PRIVACY: these are the user's own coordinates. Read on demand, held only
// while a panel is open, never logged.
import * as FileSystem from "expo-file-system/legacy";
import {
  computeTrackDetail,
  importedFeaturesToSeries,
  toElevationLine,
  type ImportedFeature,
  type TrackDetail,
} from "@logjam/shared";

/**
 * Ceiling on what will be summarised, in positions.
 *
 * The whole file goes through `JSON.parse` into one JS object graph, and Hermes
 * has no JIT — the import pipeline's own history is a catalogue of what that
 * costs on device (mobile/CLAUDE.md, GeoPDF import). A half-million-position
 * file is inside `MAX_IMPORT_POSITIONS` and would freeze the UI thread for
 * seconds to produce numbers nobody asked for twice.
 *
 * ponytail: a flat refusal, not a decimator. If real files start landing above
 * it, the upgrade path is a streaming reader, not a bigger number.
 */
export const MAX_STATS_POSITIONS = 200_000;

export class TooManyPointsError extends Error {
  constructor() {
    super("This file has too many points to summarise.");
  }
}

/**
 * Read one stored import and summarise its lines, with the coarse line to
 * sample the DEM along. Null detail = it has no lines.
 */
export async function readImportedTrackDetail(input: {
  /** Absolute app-private path, scheme-less (VectorImport.path). */
  path: string;
  /** The row's own count, so an over-large file is refused before it is read. */
  positionCount: number;
}): Promise<{ detail: TrackDetail | null; line: [number, number][][] }> {
  if (input.positionCount > MAX_STATS_POSITIONS) throw new TooManyPointsError();
  const text = await FileSystem.readAsStringAsync(`file://${input.path}`);
  const parsed = JSON.parse(text) as { features?: ImportedFeature[] };
  const series = importedFeaturesToSeries(parsed.features ?? []);
  if (series.length < 2) return { detail: null, line: [] };
  return { detail: computeTrackDetail(series), line: toElevationLine(series) };
}
