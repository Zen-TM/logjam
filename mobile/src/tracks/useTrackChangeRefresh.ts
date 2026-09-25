// Re-read on a track write, but only while someone can see the result.
//
// `onTracksChanged` fires on every write the recorder makes, and during a
// recording that is once per delivery, for hours, with the phone in a pocket.
// Both subscribers answer it expensively — `useTracks` re-reads two whole
// tables and re-renders MapScreen (MLRN memoises no layer and re-commits props
// per layer per render, ~71 of them in the Protomaps band), and
// `useTrackDetail` re-reads the entire point series. None of that is visible
// while the app is backgrounded, and the recorder is the one part of this app
// that keeps writing when nothing is on screen.
//
// So a write arriving in the background is REMEMBERED, not answered: the flag
// is set, the read is skipped, and a single read happens on return to the
// foreground. Nothing goes stale, because nothing was being looked at.
//
// `=== "background"`, not `!== "active"`: Android reports `"unknown"` until the
// first AppState event and the bundle can evaluate before the activity
// resumes. Reading that as "not foreground" would defer the FIRST read of a
// cold launch and leave the map blank until something else happened. Fail
// open, the same direction MapScreen's `appActive` and syncEngine's retry gate
// chose.
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { onTracksChanged } from "./tracksDb";

export function useTrackChangeRefresh(refresh: () => void, enabled = true): void {
  // The caller's closure changes on every render; re-subscribing on that would
  // tear the subscription down and rebuild it at render rate.
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    let missed = false;
    const run = () => latest.current();
    run();
    const unsubscribe = onTracksChanged(() => {
      if (AppState.currentState === "background") {
        missed = true;
        return;
      }
      run();
    });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !missed) return;
      missed = false;
      run();
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, [enabled]);
}
