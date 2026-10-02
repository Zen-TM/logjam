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

const NO_LINE: [number, number][][] = [];

export function useImportedTrackDetail(
  imported: VectorImport | null,
  enabled: boolean,
): {
  detail: TrackDetail | null;
  loading: boolean;
  error: string | null;
  /** The imported lines, coarsened for sampling the DEM along. */
  line: [number, number][][];
} {
  // The last read, tagged with the import it was for: anything else showing is
  // derived from whether a read is due and whether this one has landed.
  const [settled, setSettled] = useState<{
    imported: VectorImport;
    detail: TrackDetail | null;
    line: [number, number][][];
    error: string | null;
  } | null>(null);

  // No bytes on this phone yet — the row synced ahead of its file. Not an
  // error: nothing to read until the user downloads it.
  const path = enabled && imported != null ? imported.path : null;

  useEffect(() => {
    if (path === null || imported == null) return;
    let current = true;
    readImportedTrackDetail({
      path,
      positionCount: imported.positionCount,
    })
      .then((next) => {
        if (!current) return;
        setSettled({
          imported,
          detail: next.detail,
          line: next.line,
          error: null,
        });
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!current) return;
        // The over-large refusal carries its own sentence; anything else is a
        // read that failed, and the file's contents never reach this string.
        setSettled({
          imported,
          detail: null,
          line: NO_LINE,
          error: messageFromError(err, "Couldn't read that file."),
        });
      });
    return () => {
      current = false;
    };
  }, [imported, path]);

  const result =
    path !== null && settled?.imported === imported ? settled : null;
  const detail = result?.detail ?? null;
  const line = result?.line ?? NO_LINE;
  const error = result?.error ?? null;
  const loading = path !== null && result == null;

  return { detail, loading, error, line };
}
