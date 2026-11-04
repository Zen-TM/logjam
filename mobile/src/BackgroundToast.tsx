// How BACKGROUND work announces itself, wherever the user has got to.
//
// Mounted once, at the app shell, because the work outlives the screen that
// started it — the Saved tab's own toast would only fire if the user happened
// to still be standing there when the job landed (DESIGN.md, the corollary).
//
// Four sources, one component: a GeoPDF import, a region download run,
// Settings → Map's place names download and a plan's Download for the trip. A second mounted toast would let two
// of them overlap in the same dock, and the user does not care which
// subsystem is talking.
//
// It draws nothing itself: `ToastHost` (ui/Toast.tsx) is the one place a toast
// shows, centred above the tab bar, whichever screen or job raised it.
import { useEffect, useState } from "react";

import { Toast, type ToastMessage } from "./ui";
import { onGeoPdfImportToast } from "./geopdf/importRunner";
import { onPlaceRegistryToast } from "./offline/placeRegistry";
import { onRegionDownloadToast } from "./offline/regionDownloadQueue";
import { onPlanDownloadToast } from "./plans/planDownloads";

export function BackgroundToast() {
  const [message, setMessage] = useState<ToastMessage | null>(null);

  useEffect(() => {
    // The nonce is what re-runs the animation when the same text repeats.
    const show = (next: Omit<ToastMessage, "nonce">) =>
      setMessage({ ...next, nonce: Date.now() });
    const unsubscribes = [
      onGeoPdfImportToast(show),
      onRegionDownloadToast(show),
      onPlaceRegistryToast(show),
      onPlanDownloadToast(show),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

  return <Toast message={message} onDismissed={() => setMessage(null)} />;
}
