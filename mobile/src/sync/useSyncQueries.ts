// Mirror-backed data hooks — the offline-first replacement for useApiQuery
// on synced entities. Reads come from the SQLite mirror (instant, works in
// airplane mode); a manual refresh triggers a sync cycle and the hook
// re-reads when the mirror changes.
import { useCallback, useEffect, useState } from "react";

import {
  hasMirrorSynced,
  countMediaByLinkedId,
  countOutgoingSharesByPlace,
  incomingShareOwnerByPlace,
  listPlaceTrackMedia,
  listMediaForLinked,
  listMirrorPlaces,
  listMirrorTrips,
  listMirrorPlaceLinks,
  listMirrorRoutes,
  getMirrorPlace,
  getMirrorTrip,
  type MirrorPlace,
  type MirrorMedia,
  type MirrorTrip,
  type MirrorPlaceLink,
  type MirrorRoute,
} from "./mirrorStore";
import { mirrorQueryError } from "./mirrorQueryError";
import { onMirrorChanged } from "./syncDb";
import { countPendingOps, pendingCreateIds } from "./outbox";
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
  /**
   * An ACTIONABLE first-sync failure. Null for a never-synced offline user —
   * see `mirrorQueryError`.
   */
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
    error: mirrorQueryError(neverSynced, syncStatus),
    refresh,
  };
}

const readPlaces = () => listMirrorPlaces();
const readTrips = () => listMirrorTrips();
const readPlaceLinks = () => listMirrorPlaceLinks();
const readShareCounts = () => countOutgoingSharesByPlace();
const readIncomingShareOwners = () => incomingShareOwnerByPlace();

export function useMirrorPlaces(): MirrorQueryState<MirrorPlace[]> {
  return useMirrorQuery(readPlaces);
}

export function useMirrorTrips(): MirrorQueryState<MirrorTrip[]> {
  return useMirrorQuery(readTrips);
}

export function useMirrorPlace(id: string): MirrorQueryState<MirrorPlace | null> {
  const read = useCallback(() => getMirrorPlace(id), [id]);
  return useMirrorQuery(read);
}

export function useMirrorTrip(id: string): MirrorQueryState<MirrorTrip | null> {
  const read = useCallback(() => getMirrorTrip(id), [id]);
  return useMirrorQuery(read);
}

export function useMirrorPlaceLinks(): MirrorQueryState<MirrorPlaceLink[]> {
  return useMirrorQuery(readPlaceLinks);
}

/** Every route the account can see (own + through a place share). */
export function useMirrorRoutes(): MirrorQueryState<MirrorRoute[]> {
  return useMirrorQuery(listMirrorRoutes);
}

/**
 * Every place route attachment on this account, for the map's "Place routes"
 * layer. Mirror-backed, so it works with no signal.
 */
export function useMirrorPlaceTracks(
  trackMimeTypes: readonly string[],
): MirrorQueryState<MirrorMedia[]> {
  const read = useCallback(
    () => listPlaceTrackMedia(trackMimeTypes),
    [trackMimeTypes],
  );
  return useMirrorQuery(read);
}

/** Attachment counts keyed by linked row id — for list badges. */
export function useMirrorMediaCounts(
  linkedType: "place" | "tripLog",
): MirrorQueryState<Record<string, number>> {
  const read = useCallback(() => countMediaByLinkedId(linkedType), [linkedType]);
  return useMirrorQuery(read);
}

/** Share fan-out per owned place, for the "Shared with N" badge. */
export function useMirrorShareCounts(): MirrorQueryState<Record<string, number>> {
  return useMirrorQuery(readShareCounts);
}

/**
 * Username of whoever shared each incoming place with the viewer, keyed by
 * place id — the "From <name>" mark on a shared route or place in Saved.
 */
export function useMirrorIncomingShareOwners(): MirrorQueryState<Record<string, string>> {
  return useMirrorQuery(readIncomingShareOwners);
}

/** Media attached to one place or trip, pendingUpload rows included. */
export function useMirrorMedia(
  linkedType: "place" | "tripLog",
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
/**
 * Ids the account does not hold yet, refreshed on the same two signals the
 * pending count is — a flush changes both, and a Saved row's backed-up mark and
 * the hero's "N waiting to sync" disagreeing would be worse than either being
 * slightly late.
 */
export function usePendingCreateIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      pendingCreateIds()
        .then((next) => {
          if (!cancelled) setIds(next);
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
  return ids;
}

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

/** Live count of everything on the Account sync issues screen. */
export function useSyncIssueCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      countSyncIssues()
        .then((n) => {
          if (!cancelled) setCount(n);
        })
        // Not best-effort cleanup: a failure here is a local SQLite read that
        // broke, and the badge silently freezing is the only symptom.
        .catch(console.error);
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
