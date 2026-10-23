// The signed-in user's completed LiDAR jobs, with presigned URLs for their
// layers and, for a sharpened job, its area's archives. Refetched before the
// URLs expire (24 h), so a tile request never meets a 403 mid-session.
//
// PRIVACY: a session expiry signs out with no reload, so the next person to
// sign in shares the tab with the last one's state. Signing out forgets the
// list, and a list asked for before then is dropped when it arrives, so no
// one is drawn another user's areas (useCompletedTopoJobs.test.ts).
import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "./placeUtils";
import type {
  CompletedOverlaysResponse,
  CompletedTopoJob,
} from "./topoLayerTypes";

export function useCompletedTopoJobs(loadsUserData: boolean) {
  const [jobs, setJobs] = useState<CompletedTopoJob[]>([]);
  // True once the first fetch settles, either way: an empty list before then
  // is not "no topos yet" (shared/DESIGN.md §11).
  const [loaded, setLoaded] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  // Which signed-in stretch a request belongs to: bumped on signing out.
  const session = useRef(0);

  // During render, so not even one frame draws the last user's areas.
  const [signedOutFor, setSignedOutFor] = useState(!loadsUserData);
  if (!loadsUserData !== signedOutFor) {
    setSignedOutFor(!loadsUserData);
    if (!loadsUserData) {
      session.current += 1;
      setJobs([]);
      setLoaded(false);
      setExpiresAt(null);
    }
  }

  const refetch = useCallback(() => {
    const asked = session.current;
    return (
      apiFetch<CompletedOverlaysResponse>("/topo-jobs/completed-overlays")
        .then((answer) => {
          if (asked !== session.current) return;
          setJobs(answer.jobs);
          setExpiresAt(answer.expiresAt);
        })
        // Best-effort: called again on the next poll tick / job completion,
        // so a transient failure here is non-critical.
        .catch((err) => {
          console.error(err);
        })
        .finally(() => {
          if (asked === session.current) setLoaded(true);
        })
    );
  }, []);

  useEffect(() => {
    if (!loadsUserData) return;
    refetch();
  }, [loadsUserData, refetch]);

  // Pre-refetch the presigned URLs ~30 min before the server-reported expiry.
  useEffect(() => {
    if (!loadsUserData || !expiresAt) return;
    const delay = new Date(expiresAt).getTime() - 30 * 60 * 1000 - Date.now();
    if (delay <= 0) {
      refetch();
      return;
    }
    const timer = setTimeout(refetch, delay);
    return () => clearTimeout(timer);
  }, [loadsUserData, expiresAt, refetch]);

  return { jobs, loaded, refetch };
}
