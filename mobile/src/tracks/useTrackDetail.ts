// Everything a track's stats panel shows, derived on demand from the stored
// series.
//
// DERIVED, NOT STORED. The `track` row caches four numbers because the
// recorder writes them as it goes; the rest — moving time, pace, the profiles
// — is computed here when something is actually looking at it. That is what
// keeps a new stat from being a schema migration, and it is the same reason
// `elevation.ts` refuses to persist a route's profile.
//
// It runs only while a panel is OPEN (`enabled`), which is also the only time
// the phone is in someone's hand: a full read of the series plus O(points) of
// arithmetic is exactly the work `refreshTrackStats` was moved out of the
// background to avoid (mobile/CLAUDE.md, Battery).
//
// PRIVACY: the series is precise location history. It stays in memory for as
// long as the panel is open and is never logged.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  computeTrackDetail,
  type RecordedTrackPoint,
  type TrackDetail,
} from "@logjam/shared";

import { toElevationLine } from "./trackLine";
import { listTrackPoints } from "./tracksDb";
import { useTrackChangeRefresh } from "./useTrackChangeRefresh";

/**
 * Points a LIVE recording must grow by before the DEM line is republished.
 *
 * The stats recompute on every written batch, which is what makes the open
 * panel a live readout — but the elevation hook keyed on that line would then
 * re-sample the DEM every batch, and off a downloaded region that is a network
 * request per batch for a number nobody watches change. At the finest rate 20
 * points is about a minute.
 */
const ELEVATION_LINE_REFRESH_POINTS = 20;

export function useTrackDetail(
  trackId: string | null,
  enabled: boolean,
  /**
   * The recording's wall-clock length, so the stretch after the last accepted
   * fix is counted (see `computeTrackDetail`'s `recordedMs`). A caller without
   * one — an import — passes nothing and gets the fixes' own span.
   */
  recordedMs?: number | null,
): {
  detail: TrackDetail | null;
  loading: boolean;
  /** The track as coarse per-segment lines, for sampling the DEM along. */
  line: [number, number][][];
} {
  // The SERIES is state; the detail is derived from it. `recordedMs` ticks
  // once a second on a live recording, and folding it in here rather than in
  // the read means a tick re-runs the arithmetic (O(points), no I/O) instead of
  // re-reading the whole series from SQLite every second.
  const [points, setPoints] = useState<RecordedTrackPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [line, setLine] = useState<[number, number][][]>([]);
  const linePointCount = useRef(0);
  const detail = useMemo(
    () => (points.length > 0 ? computeTrackDetail(points, { recordedMs }) : null),
    [points, recordedMs],
  );

  // A panel left open while the phone goes back in a pocket would otherwise
  // re-read the WHOLE series on every delivery, for hours — see
  // `useTrackChangeRefresh`.
  const [readNonce, setReadNonce] = useState(0);
  useTrackChangeRefresh(
    () => setReadNonce((n) => n + 1),
    enabled && trackId != null,
  );

  useEffect(() => {
    if (!enabled || trackId == null) {
      // Dropping the last panel's numbers matters: reopening on another track
      // would otherwise show the previous one's stats for a frame, which is
      // indistinguishable from this track's.
      setPoints([]);
      setLine([]);
      linePointCount.current = 0;
      setLoading(false);
      return;
    }

    let current = true;
    setLoading(true);
    const read = () => {
      listTrackPoints(trackId)
        .then((points) => {
          if (!current) return;
          setPoints(points);
          // First read always publishes — the throttle is for a recording that
          // GROWS, and a 10-point track must not wait for points that will
          // never come.
          if (
            points.length >= 2 &&
            (linePointCount.current === 0 ||
              points.length - linePointCount.current >=
                ELEVATION_LINE_REFRESH_POINTS)
          ) {
            linePointCount.current = points.length;
            setLine(toElevationLine(points));
          }
          setLoading(false);
        })
        .catch((err: unknown) => {
          console.error(err);
          if (!current) return;
          setLoading(false);
        });
    };

    // A live recording appends a batch every fix, and re-reading on that is
    // what makes an open panel a live readout rather than a snapshot of the
    // moment it opened. `readNonce` is that signal, already gated on the app
    // being in front of someone. A finished track never moves it.
    read();
    return () => {
      current = false;
    };
  }, [trackId, enabled, readNonce]);

  return { detail, loading, line };
}
