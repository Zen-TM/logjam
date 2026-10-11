// A track file's stats and chart series, read on demand for its page.
//
// Logjam Web's counterpart of Logjam GPS's `useImportedTrackDetail`: the same
// shared parse and the same stats engine over the file's own points, so the
// two clients chart one file the same way. Derived, never stored.
//
// The file comes from its presigned URL (the API never echoes a track's
// contents) through the download the map already shares (`fetchTrackText`).
//
// PRIVACY: the series is precise location history. It is held only while the
// page is open and neither it nor a parse failure is ever logged.
import { useEffect, useEffectEvent, useState } from "react";
import {
  computeTrackDetail,
  importedFeaturesToSeries,
  parseVectorImport,
  toElevationLine,
  type TrackDetail,
} from "@logjam/shared";
import { fetchTrackText } from "./trackGeo";

export type TrackFileSource = {
  mediaId: string;
  /** Its extension picks the parser. */
  filename: string;
  /** Where to download it, asked for only when no one has yet. */
  displayUrl: () => string | Promise<string>;
  /** A recording's own clock (`TrackMetadata.durationMs`), where the row
   *  carries one: see `computeTrackDetail`'s `recordedMs`. */
  recordedMs?: number | null;
};

const NO_LINE: [number, number][][] = [];

/**
 * Null detail = the file has no line to summarise (waypoints only).
 *
 * ponytail: parsed on the main thread. An import at the upload ceiling
 * (`MAX_IMPORT_POSITIONS`) is a pause of about a second when its page opens;
 * a worker is the upgrade if that is ever felt.
 */
export function trackFileDetail(
  filename: string,
  text: string,
  recordedMs?: number | null,
): { detail: TrackDetail | null; line: [number, number][][] } {
  const series = importedFeaturesToSeries(
    parseVectorImport(filename, text).features,
  );
  if (series.length < 2) return { detail: null, line: NO_LINE };
  return {
    detail: computeTrackDetail(series, { recordedMs }),
    line: toElevationLine(series),
  };
}

export function useTrackFileDetail(source: TrackFileSource | null): {
  detail: TrackDetail | null;
  loading: boolean;
  error: string | null;
  /** The track thinned to per-segment lines, for sampling the DEM along. */
  line: [number, number][][];
} {
  // The last read, tagged with the file it was for, so another file's numbers
  // are never shown under this one's name.
  const [settled, setSettled] = useState<{
    mediaId: string;
    detail: TrackDetail | null;
    line: [number, number][][];
    error: string | null;
  } | null>(null);

  const mediaId = source?.mediaId ?? null;
  const filename = source?.filename ?? null;
  const recordedMs = source?.recordedMs ?? null;
  // A presigned URL rotates with every listing; a new one is not a new file.
  const displayUrl = useEffectEvent(() => source!.displayUrl());

  useEffect(() => {
    if (mediaId === null || filename === null) return;
    let current = true;
    fetchTrackText(mediaId, displayUrl)
      .then((text) => {
        if (!current) return;
        setSettled({
          mediaId,
          ...trackFileDetail(filename, text, recordedMs),
          error: null,
        });
      })
      .catch(() => {
        if (!current) return;
        // Our own sentence, and nothing logged: a parse error can quote the
        // file.
        setSettled({
          mediaId,
          detail: null,
          line: NO_LINE,
          error: "Couldn't read that file.",
        });
      });
    return () => {
      current = false;
    };
  }, [mediaId, filename, recordedMs]);

  const result =
    mediaId !== null && settled?.mediaId === mediaId ? settled : null;
  return {
    detail: result?.detail ?? null,
    line: result?.line ?? NO_LINE,
    error: result?.error ?? null,
    loading: mediaId !== null && result === null,
  };
}
