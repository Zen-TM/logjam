// An imported file's stats, read on demand.
//
// The import's counterpart of `tracks/useTrackDetail`: same contract, same
// reason for existing (derive, never store), different source — the series
// comes out of the stored GeoJSON rather than out of SQLite. An import never
// changes after it lands, so unlike a live recording there is nothing to
// subscribe to; it reads once per open.
import { useEffect, useState } from "react";
import { messageFromError, type TrackDetail } from "@logjam/shared";

import type { VectorImport } from "./importsDb";
import { readImportedTrackDetail } from "./importedTrackSeries";

export function useImportedTrackDetail(
  imported: VectorImport | null,
  enabled: boolean,
): {
  detail: TrackDetail | null;
  loading: boolean;
  error: string | null;
  /** The imported lines, coarsened for sampling the DEM along. */
  line: [number, number][];
} {
  const [detail, setDetail] = useState<TrackDetail | null>(null);
  const [line, setLine] = useState<[number, number][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || imported == null) {
      setDetail(null);
      setLine([]);
      setError(null);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    readImportedTrackDetail({
      path: imported.path,
      positionCount: imported.positionCount,
    })
      .then((next) => {
        if (!current) return;
        setDetail(next.detail);
        setLine(next.line);
        setLoading(false);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!current) return;
        // The over-large refusal carries its own sentence; anything else is a
        // read that failed, and the file's contents never reach this string.
        setError(messageFromError(err, "Couldn't read that file."));
        setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [imported, enabled]);

  return { detail, loading, error, line };
}
