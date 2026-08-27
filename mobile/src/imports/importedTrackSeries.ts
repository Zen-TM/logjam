// An imported file's lines, as a track series the shared stats engine can read.
//
// The point of this file is that an imported GPX and a recording made on this
// phone are the same object: both are a line someone walked, and both deserve
// the same panel (DESIGN.md §7). What differs is what the file carried —
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
  type ImportedFeature,
  type TrackDetail,
  type TrackSeriesPoint,
} from "@logjam/shared";

import { toElevationLine } from "../tracks/trackLine";

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
 * Every line in the file as one series, each line its own segment — which is
 * exactly how the stats engine treats a pause: no distance and no time is
 * counted across the join between two of them.
 */
export function importedFeaturesToSeries(
  features: readonly ImportedFeature[],
): TrackSeriesPoint[] {
  const series: TrackSeriesPoint[] = [];
  let segment = 0;
  for (const feature of features) {
    const geometry = feature.geometry;
    const lines =
      geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "MultiLineString"
          ? geometry.coordinates
          : [];
    // Only a plain LineString can carry `coordTimes` — a MultiLineString's
    // parallel array would have to be nested, and no writer we read produces
    // one, so guessing at its shape would invent times rather than read them.
    const coordTimes =
      geometry.type === "LineString" ? feature.properties.coordTimes : undefined;
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        const position = line[i]!;
        const altitudeM = position.length > 2 ? position[2]! : null;
        const time = coordTimes?.[i];
        const timestampMs = time == null ? null : Date.parse(time);
        series.push({
          lon: position[0]!,
          lat: position[1]!,
          altitudeM: altitudeM != null && Number.isFinite(altitudeM) ? altitudeM : null,
          timestampMs:
            timestampMs != null && Number.isFinite(timestampMs) ? timestampMs : null,
          segment,
        });
      }
      segment += 1;
    }
  }
  return series;
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
