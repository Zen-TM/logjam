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
import { useEffect, useState } from "react";
import { computeTrackDetail, type TrackDetail } from "@logjam/shared";

import { listTrackPoints, onTracksChanged } from "./tracksDb";

export function useTrackDetail(
  trackId: string | null,
  enabled: boolean,
): { detail: TrackDetail | null; loading: boolean } {
  const [detail, setDetail] = useState<TrackDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || trackId == null) {
      // Dropping the last panel's numbers matters: reopening on another track
      // would otherwise show the previous one's stats for a frame, which is
      // indistinguishable from this track's.
      setDetail(null);
      setLoading(false);
      return;
    }

    let current = true;
    setLoading(true);
    const read = () => {
      listTrackPoints(trackId)
        .then((points) => {
          if (!current) return;
          setDetail(computeTrackDetail(points));
          setLoading(false);
        })
        .catch((err: unknown) => {
          console.error(err);
          if (!current) return;
          setLoading(false);
        });
    };

    read();
    // A live recording appends a batch every fix; each one notifies, and
    // recomputing on that is what makes the open panel a live readout rather
    // than a snapshot of the moment it opened. A finished track never fires,
    // so this costs a subscription and nothing else.
    const unsubscribe = onTracksChanged(() => {
      if (current) read();
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [trackId, enabled]);

  return { detail, loading };
}
