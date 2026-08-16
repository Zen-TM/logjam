// How BACKGROUND work announces itself, wherever the user has got to.
//
// Mounted once, at the app shell, because the work outlives the screen that
// started it — the Saved tab's own toast would only fire if the user happened
// to still be standing there when the job landed (DESIGN.md §6, the corollary).
//
// Two sources, one component: a GeoPDF import and a region download run. A
// second mounted toast would let two of them overlap in the same dock, and the
// user does not care which subsystem is talking.
//
// It docks clear of the tab bar so an outcome doesn't land on top of the
// navigation the user is about to use.
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Toast, type ToastMessage } from "./ui/Toast";
import { onGeoPdfImportToast } from "./geopdf/importRunner";
import { onRegionDownloadToast } from "./offline/regionDownloadQueue";

/** Bottom tab bar height plus a little air — the toast sits above both. */
const TAB_BAR_CLEARANCE = 64;

export function BackgroundToast() {
  const [message, setMessage] = useState<ToastMessage | null>(null);

  useEffect(() => {
    // The nonce is what re-runs the animation when the same text repeats.
    const show = (next: Omit<ToastMessage, "nonce">) =>
      setMessage({ ...next, nonce: Date.now() });
    const unsubscribes = [onGeoPdfImportToast(show), onRegionDownloadToast(show)];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

  return (
    <View style={styles.dock} pointerEvents="none">
      <Toast message={message} onDismissed={() => setMessage(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: TAB_BAR_CLEARANCE,
  },
});
