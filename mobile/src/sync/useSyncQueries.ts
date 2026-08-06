// Mirror-backed data hooks — the offline-first replacement for useApiQuery
// on synced entities. Reads come from the SQLite mirror (instant, works in
// airplane mode); a manual refresh triggers a sync cycle and the hook
// re-reads when the mirror changes.
import { useCallback, useEffect, useState } from "react";

import {
  hasMirrorSynced,
  countMediaByLinkedId,
  countOutgoingSharesByCanyon,
  listCanyonTrackMedia,
  listMediaForLinked,
  listMirrorCanyons,
  listMirrorTrips,
  listMirrorWaypoints,
  listMirrorRoutes,
  getMirrorCanyon,
  getMirrorTrip,
  type MirrorCanyon,
  type MirrorMedia,
  type MirrorTrip,
  type MirrorWaypoint,
  type MirrorRoute,
} from "./mirrorStore";
import { onMirrorChanged } from "./syncDb";
import { countPendingOps } from "./outbox";
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
const readShareCounts = () => countOutgoingSharesByCanyon();

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

export function useMirrorTrip(id: string): MirrorQueryState<MirrorTrip | null> {
  const read = useCallback(() => getMirrorTrip(id), [id]);
  return useMirrorQuery(read);
}

export function useMirrorWaypoints(): MirrorQueryState<MirrorWaypoint[]> {
  return useMirrorQuery(readWaypoints);
}

/** Every route the account can see (own + through a canyon share). */
export function useMirrorRoutes(): MirrorQueryState<MirrorRoute[]> {
  return useMirrorQuery(listMirrorRoutes);
}

/**
 * Every canyon route attachment on this account, for the map's "Canyon routes"
 * layer. Mirror-backed, so it works with no signal.
 */
export function useMirrorCanyonTracks(
  trackMimeTypes: readonly string[],
): MirrorQueryState<MirrorMedia[]> {
  const read = useCallback(
    () => listCanyonTrackMedia(trackMimeTypes),
    [trackMimeTypes],
  );
  return useMirrorQuery(read);
}

/** Attachment counts keyed by linked row id — for list badges. */
export function useMirrorMediaCounts(
  linkedType: "canyon" | "tripLog",
): MirrorQueryState<Record<string, number>> {
  const read = useCallback(() => countMediaByLinkedId(linkedType), [linkedType]);
  return useMirrorQuery(read);
}

/** Share fan-out per owned canyon, for the "Shared with N" badge. */
export function useMirrorShareCounts(): MirrorQueryState<Record<string, number>> {
  return useMirrorQuery(readShareCounts);
}

/** Media attached to one canyon or trip, pendingUpload rows included. */
export function useMirrorMedia(
  linkedType: "canyon" | "tripLog",
  linkedId: string,
): MirrorQueryState<MirrorMedia[]> {
  const read = useCallback(
    () => listMediaForLinked(linkedType, linkedId),
    [linkedType, linkedId],
  );
  return useMirrorQuery(read);
}

/**
 * How many local changes are still waiting to reach the server.
 *
 * The reassurance an offline-first app owes the user: their edit is not lost, it
 * is queued. Counts every outbox row that hasn't flushed, media uploads
 * included, and updates live as the queue drains.
 */
export function usePendingSyncCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      countPendingOps()
        .then((n) => {
          if (!cancelled) setCount(n);
        })
        .catch((err: unknown) => console.error(err));
    };
    refresh();
    const unsubscribeMirror = onMirrorChanged(refresh);
    const unsubscribeSync = onSyncStatusChanged(refresh);
    return () => {
      cancelled = true;
      unsubscribeMirror();
      unsubscribeSync();
    };
  }, []);
  return count;
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
