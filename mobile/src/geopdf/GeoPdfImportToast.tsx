// How a background GeoPDF import announces itself, wherever the user has got
// to. Mounted once, at the app shell, because the import outlives the screen
// that started it — the Saved tab's own toast would only fire if the user
// happened to still be standing there when the render finished.
//
// It docks clear of the tab bar so a "GeoPDF imported" doesn't land on top of
// the navigation the user is about to use.
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Toast, type ToastMessage } from "../ui/Toast";
import { onGeoPdfImportToast } from "./importRunner";

/** Bottom tab bar height plus a little air — the toast sits above both. */
const TAB_BAR_CLEARANCE = 64;

export function GeoPdfImportToast() {
  const [message, setMessage] = useState<ToastMessage | null>(null);

  useEffect(
    () =>
      onGeoPdfImportToast((next) =>
        // The nonce is what re-runs the animation when the same text repeats.
        setMessage({ ...next, nonce: Date.now() }),
      ),
    [],
  );

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
