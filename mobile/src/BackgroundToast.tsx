// How BACKGROUND work announces itself, wherever the user has got to.
//
// Mounted once, at the app shell, because the work outlives the screen that
// started it — the Saved tab's own toast would only fire if the user happened
// to still be standing there when the job landed (DESIGN.md, the corollary).
//
// Six sources, one component: a GeoPDF import, a region download run, a
// plan's Download for the trip, a finished recording, a refused permission and
// a blocked leave from route editing. A second mounted toast would let two of
// them overlap, and the user does not care which subsystem is talking.
//
// It draws nothing itself: `ToastHost` (ui/Toast.tsx) is the one place a toast
// shows, centred above the tab bar, whichever screen or job raised it.
import { useEffect, useState } from "react";

import { Toast, type ToastMessage } from "./ui";
import { onGeoPdfImportToast } from "./geopdf/importRunner";
import { FINISH_ROUTE_FIRST, onRouteLeaveBlocked } from "./map/routeEditLock";
import { onRegionDownloadToast } from "./offline/regionDownloadQueue";
import { onPermissionToast } from "./permissionAlert";
import { onPlanDownloadToast } from "./plans/planDownloads";
import {
  onLogTripRequest,
  onRecordingToast,
} from "./tracks/finishRecordingPrompt";
import { LogTripFromTrackSheet } from "./tracks/LogTripFromTrackSheet";
import type { TripTrackSource } from "./tracks/tripTrackSource";

export function BackgroundToast() {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  // The finish toast's "Log a trip": the form opens here, over whatever screen
  // the user is on, because the recorder's own sheet has gone by then.
  const [logging, setLogging] = useState<TripTrackSource | null>(null);

  useEffect(() => {
    // The nonce is what re-runs the animation when the same text repeats.
    const show = (next: Omit<ToastMessage, "nonce">) =>
      setMessage({ ...next, nonce: Date.now() });
    const unsubscribes = [
      onGeoPdfImportToast(show),
      onRegionDownloadToast(show),
      onPlanDownloadToast(show),
      onRecordingToast(show),
      onPermissionToast(show),
      onRouteLeaveBlocked(() =>
        show({ text: FINISH_ROUTE_FIRST, tone: "error" }),
      ),
      onLogTripRequest(setLogging),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

  return (
    <>
      <Toast message={message} onDismissed={() => setMessage(null)} />
      {/* Mounted only while open: it carries the whole trip form and its
          mirror queries, which nothing else at the root needs. */}
      {logging ? (
        <LogTripFromTrackSheet
          track={logging}
          onClose={() => setLogging(null)}
          onSaved={(text) => {
            setLogging(null);
            setMessage({ text, tone: "done", nonce: Date.now() });
          }}
        />
      ) : null}
    </>
  );
}
