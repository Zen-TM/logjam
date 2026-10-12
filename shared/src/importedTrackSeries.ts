// An imported file's lines, as a track series the stats engine can read.
//
// Only LINES are read. A file of waypoints has no distance to report, and a
// polygon's perimeter is not a walk.
import type { TrackSeriesPoint } from "./trackStats.js";
import type { ImportedFeature } from "./vectorImport.js";

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
      geometry.type === "LineString"
        ? feature.properties.coordTimes
        : undefined;
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        const position = line[i]!;
        const altitudeM = position.length > 2 ? position[2]! : null;
        const time = coordTimes?.[i];
        const timestampMs = time == null ? null : Date.parse(time);
        series.push({
          lon: position[0]!,
          lat: position[1]!,
          altitudeM:
            altitudeM != null && Number.isFinite(altitudeM) ? altitudeM : null,
          timestampMs:
            timestampMs != null && Number.isFinite(timestampMs)
              ? timestampMs
              : null,
          segment,
        });
      }
      segment += 1;
    }
  }
  return series;
}
