// One job of a region download run — which basemap, how far in, and the action
// its state allows (pause/resume, stop, or the sentence explaining a failure).
//
// It lives here rather than on a screen because the run does: the progress
// SCREEN is gone and Saved shows the run as one card per area, with these rows
// behind its ⋯ sheet.
//
// PRIVACY: a row carries a basemap label and counts. Never the bbox, never a
// path.
import { Alert, StyleSheet, View } from "react-native";

import { formatBytes } from "../format";
import { assetHue, spacing, theme } from "../theme";
import { Button, Row } from "../ui";
import {
  cancelRegionDownload,
  pauseRegionDownload,
  resumeRegionDownload,
  type RegionJob,
} from "./regionDownloadQueue";
import { canPause, isRetryableFailure } from "./regionJobStatus";

export function RegionDownloadRow({ job }: { job: RegionJob }) {
  const { progress, state, spec } = job;

  const subtitle = (() => {
    if (state.kind === "queued") return "Waiting its turn";
    if (state.kind === "ready") {
      return state.gaps > 0
        ? `Saved · ${state.gaps} tiles unavailable`
        : "Saved";
    }
    if (state.kind === "failed") {
      switch (state.code) {
        case "provider-errors":
          return "Too many tiles wouldn't load. Try again later.";
        case "region-rejected":
          return state.detail === "too-large"
            ? "Pick a smaller area — up to 40 km across."
            : "Pick an area inside NSW.";
        case "source-unavailable":
          // Not the phone's fault and not fixable by retrying, so it doesn't
          // say "try again" — this is the vector clip's 5xx.
          return "Logjam couldn't prepare this map right now. Other maps still work.";
        default:
          // The detail is the message from the exception that ended the run,
          // scrubbed (see failureDetail). Without it this row said only "that
          // didn't finish", which told the user nothing to act on and left a
          // developer with a logcat line nobody was attached to.
          return state.detail
            ? `Download didn't finish: ${state.detail}`
            : "Download didn't finish. Try again.";
      }
    }
    if (state.kind === "paused") {
      switch (state.reason) {
        case "connectivity":
          return "Paused — waiting for Wi-Fi";
        case "background":
          return "Paused — Logjam has to stay open to download";
        case "provider-backoff":
          return "Paused — the map service is busy";
        default:
          return "Paused";
      }
    }
    // The vector clip counts bytes, not tiles: it is one file, so a tile
    // tally would read "0 of 0" for its whole run.
    if (progress.tilesTotal === 0) {
      return progress.bytesTotal > 0
        ? `${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)}`
        : "Starting…";
    }
    const gaps = progress.tilesGap > 0 ? ` · ${progress.tilesGap} not available` : "";
    return `${progress.tilesDone.toLocaleString()} of ${progress.tilesTotal.toLocaleString()} tiles${gaps}`;
  })();

  const barFraction =
    state.kind !== "downloading"
      ? null
      : progress.tilesTotal > 0
        ? progress.tilesDone / progress.tilesTotal
        : progress.bytesTotal > 0
          ? progress.bytesDone / progress.bytesTotal
          : 0;

  return (
    <Row
      icon={state.kind === "ready" ? "check-circle" : "download"}
      hue={state.kind === "failed" ? theme.warning : assetHue.region}
      title={spec.label}
      subtitle={subtitle}
      // A failure subtitle is a short explanation, not a status word, and one
      // line clipped "The other maps still work" — the half that stops the
      // message reading as "the whole download is broken".
      subtitleNumberOfLines={2}
      progress={barFraction}
      right={
        // A SAVED job is done with. Everything else — running, paused, and a
        // failure worth another go — keeps its actions here, which is where
        // resuming a failed download now lives: the partial file is a lossless
        // checkpoint, and the run that owns it is the honest place to offer it.
        state.kind === "ready" ? null : (
          <View style={styles.rowActions}>
            {state.kind === "downloading" ? (
              canPause(job) ? (
                <Button
                  label="Pause"
                  variant="ghost"
                  compact
                  onPress={() => pauseRegionDownload(spec.id)}
                />
              ) : null
            ) : state.kind === "failed" && !isRetryableFailure(state.code) ? (
              // Retrying a rejected area, or an endpoint that is down, repeats
              // the same failure; the row's sentence says what to do instead.
              null
            ) : (
              <Button
                label="Resume"
                variant="outlineAccent"
                compact
                onPress={() => resumeRegionDownload(spec.id)}
              />
            )}
            <Button
              label={state.kind === "failed" ? "Discard" : "Stop"}
              variant="ghost"
              compact
              onPress={() =>
                Alert.alert(
                  state.kind === "failed"
                    ? "Discard this download?"
                    : "Stop this download?",
                  "The download so far will be deleted from this phone.",
                  [
                    { text: "Keep it", style: "cancel" },
                    {
                      text: state.kind === "failed" ? "Discard" : "Stop",
                      style: "destructive",
                      onPress: () => cancelRegionDownload(spec.id),
                    },
                  ],
                )
              }
            />
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  rowActions: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
});
