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
import { canPause, isJobFinished } from "./regionJobStatus";

export function RegionDownloadRow({ job }: { job: RegionJob }) {
  const { progress, state, spec } = job;

  const subtitle = (() => {
    if (state.kind === "queued") return "Waiting its turn";
    if (state.kind === "ready") {
      return state.gaps > 0
        ? `Saved · ${state.gaps} tiles the provider doesn't have`
        : "Saved";
    }
    if (state.kind === "failed") {
      switch (state.code) {
        case "provider-errors":
          return "Too many tiles wouldn't load. Try again later.";
        case "region-rejected":
          return "The vector map only covers NSW, up to 40 km across. Pick a smaller area inside NSW.";
        case "source-unavailable":
          // Not the phone's fault and not fixable by retrying, so it doesn't
          // say "try again" — this is the vector clip's 5xx.
          return "Logjam can't cut this map right now. The other maps still work.";
        default:
          return "That didn't finish. Try again.";
      }
    }
    if (state.kind === "paused") {
      switch (state.reason) {
        case "connectivity":
          return "Paused — waiting for Wi-Fi";
        case "background":
          return "Paused — Logjam has to stay open to download";
        case "provider-backoff":
          return "Paused — the map service asked us to slow down";
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
        isJobFinished(job) ? null : (
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
            ) : (
              <Button
                label="Resume"
                variant="outlineAccent"
                compact
                onPress={() => resumeRegionDownload(spec.id)}
              />
            )}
            <Button
              label="Stop"
              variant="ghost"
              compact
              onPress={() =>
                Alert.alert(
                  "Stop this download?",
                  "The tiles saved so far are deleted from this phone.",
                  [
                    { text: "Keep going", style: "cancel" },
                    {
                      text: "Stop",
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
