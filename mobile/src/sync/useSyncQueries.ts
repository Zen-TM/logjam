// Mirror-backed data hooks — the offline-first replacement for useApiQuery
// on synced entities. Reads come from the SQLite mirror (instant, works in
// airplane mode); a manual refresh triggers a sync cycle and the hook
// re-reads when the mirror changes.
import { useCallback, useEffect, useState } from "react";

import {
  hasMirrorSynced,
  listMediaForLinked,
  listMirrorCanyons,
  listMirrorTrips,
  listMirrorWaypoints,
  getMirrorCanyon,
  type MirrorCanyon,
  type MirrorMedia,
  type MirrorTrip,
  type MirrorWaypoint,
} from "./mirrorStore";
import { onMirrorChanged } from "./syncDb";
import { countSyncIssues } from "./syncIssues";
import {
  getSyncStatus,
  onSyncStatusChanged,
  requestSync,
  type SyncStatus,
} from "./syncEngine";

export function useSyncStatus(): SyncStatus {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus);
  useEffect(() => onSyncStatusChanged(setSyncStatus), []);
  return syncStatus;
}

export type MirrorQueryState<T> = {
  data: T | null;
  /** True only before the FIRST successful read+sync — mirror data renders
   * immediately on later loads even while a refresh runs. */
  loading: boolean;
  /** Sync failure with an empty mirror (first sync offline). */
  error: string | null;
  refresh: () => void;
};

function useMirrorQuery<T>(read: () => Promise<T>): MirrorQueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [synced, setSynced] = useState<boolean | null>(null);
  const syncStatus = useSyncStatus();

  const load = useCallback(() => {
    let cancelled = false;
    Promise.all([read(), hasMirrorSynced()])
      .then(([result, hasSynced]) => {
        if (cancelled) return;
        setData(result);
        setSynced(hasSynced);
      })
      .catch((err: unknown) => {
        // A mirror read failing is a local defect, not an offline condition —
        // fail loudly in dev, render the empty state in the field.
        console.error(err);
        if (!cancelled) setSynced(false);
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  useEffect(() => {
    const cancel = load();
    const unsubscribe = onMirrorChanged(() => void load());
    return () => {
      cancel();
      unsubscribe();
    };
  }, [load]);

  const refresh = useCallback(() => {
    void requestSync();
  }, []);

  const neverSynced = synced === false;
  return {
    data,
    loading: data === null || (neverSynced && syncStatus.state === "syncing"),
    error:
      neverSynced && syncStatus.state === "error" ? syncStatus.errorMessage : null,
    refresh,
  };
}

const readCanyons = () => listMirrorCanyons();
const readTrips = () => listMirrorTrips();
const readWaypoints = () => listMirrorWaypoints();

export function useMirrorCanyons(): MirrorQueryState<MirrorCanyon[]> {
  return useMirrorQuery(readCanyons);
}

export function useMirrorTrips(): MirrorQueryState<MirrorTrip[]> {
  return useMirrorQuery(readTrips);
}

export function useMirrorCanyon(id: string): MirrorQueryState<MirrorCanyon | null> {
  const read = useCallback(() => getMirrorCanyon(id), [id]);
  return useMirrorQuery(read);
}

export function useMirrorWaypoints(): MirrorQueryState<MirrorWaypoint[]> {
  return useMirrorQuery(readWaypoints);
}

export function useMirrorCanyonMedia(
  canyonId: string,
): MirrorQueryState<MirrorMedia[]> {
  const read = useCallback(() => listMediaForLinked("canyon", canyonId), [canyonId]);
  return useMirrorQuery(read);
}

/** Live count of parked ops + shelf entries for the "Sync issues (N)" row. */
export function useSyncIssueCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      countSyncIssues()
        .then((n) => {
          if (!cancelled) setCount(n);
        })
        .catch(() => {});
    };
    refresh();
    const unsubscribe = onMirrorChanged(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return count;
}
