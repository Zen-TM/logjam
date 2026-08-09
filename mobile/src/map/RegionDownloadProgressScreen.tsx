// "Saving maps" — the screen a region download owns while it runs.
//
// WHY IT IS A SCREEN. A region download only makes progress while Logjam is in
// the foreground: the worker parks itself on `AppState !== "active"` (see
// regionDownloadQueue's auto-resume watchers), and the jobs run one at a time
// so three chosen basemaps is three sequential waits. The old design showed
// those rows inline underneath the framing controls, on a screen the user had
// every reason to leave — the map was one Back away, and leaving it is exactly
// the thing that stops the download. A screen with one job (watch this
// finish) and an exit that stays shut until it has is the honest shape for
// work the user has to stay put for.
//
// It does NOT lock the app. The queue survives leaving — the map's own
// download badge is still there, and Back is still reachable through the
// system gesture — but "Done" is the affordance this screen offers, and it
// tells the truth about when it is safe to take it.
//
// PRIVACY: rows carry a basemap label and counts. Never the bbox, never a path.
import { useEffect } from "react";
import { Alert, BackHandler, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { formatBytes } from "../format";
import { assetHue, fontSize, spacing, theme } from "../theme";
import { Button, HeroHeader, Row, StatusPill } from "../ui";
import {
  cancelRegionDownload,
  pauseRegionDownload,
  resumeRegionDownload,
  useRegionDownloads,
  type RegionJob,
} from "../offline/regionDownloadQueue";

/** Nothing more will happen to this job unless the user asks. */
function isSettled(job: RegionJob): boolean {
  return job.state.kind === "ready" || job.state.kind === "failed";
}

export function RegionDownloadProgressScreen({ onDone }: { onDone: () => void }) {
  const jobs = useRegionDownloads();
  const insets = useSafeAreaInsets();
  // Settled means "finished, one way or the other" — a failure is a finished
  // download too, and gating Done on SUCCESS would trap a user whose vector
  // clip 503'd on a screen with no way out.
  const allSettled = jobs.length > 0 && jobs.every(isSettled);
  const outstanding = jobs.filter((job) => !isSettled(job)).length;
  const failed = jobs.filter((job) => job.state.kind === "failed").length;
  const ready = jobs.filter((job) => job.state.kind === "ready").length;

  // Hardware back while work is outstanding asks first, rather than silently
  // dropping the user onto the map with the download quietly parked behind
  // them. Answering "Leave" is allowed: the queue keeps running for as long as
  // the app is foregrounded, and the map badge reports it.
  useEffect(() => {
    if (allSettled || jobs.length === 0) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      Alert.alert(
        "Still saving maps",
        "Downloads only run while Logjam is open. Leaving this screen is fine — closing the app is not.",
        [
          { text: "Stay here", style: "cancel" },
          { text: "Leave", onPress: onDone },
        ],
      );
      return true;
    });
    return () => sub.remove();
  }, [allSettled, jobs.length, onDone]);

  const totalBytes = jobs.reduce((sum, job) => sum + job.progress.bytesDone, 0);

  return (
    <View style={styles.root}>
      <HeroHeader
        eyebrow="Offline maps"
        title={allSettled ? "Saved to this phone" : "Saving maps"}
        value={totalBytes > 0 ? formatBytes(totalBytes) : undefined}
        valueSuffix={
          allSettled
            ? undefined
            : outstanding === 1
              ? "1 map to go"
              : `${outstanding} maps to go`
        }
      >
        <View style={styles.heroNote}>
          {allSettled ? (
            <StatusPill
              label={
                failed > 0
                  ? `${ready} saved · ${failed} didn't finish`
                  : "These maps work with no signal from now on"
              }
              tone={failed > 0 ? "warning" : "accent"}
              icon={failed > 0 ? "alert-triangle" : "check"}
            />
          ) : (
            <StatusPill
              label="Keep Logjam open — downloads pause in the background"
              tone="warning"
              icon="alert-triangle"
            />
          )}
        </View>
      </HeroHeader>

      <ScrollView contentContainerStyle={styles.list}>
        {jobs.length === 0 ? (
          <Text style={styles.empty}>Nothing downloading.</Text>
        ) : (
          jobs.map((job) => <DownloadRow key={job.spec.id} job={job} />)
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing(2) }]}>
        <Button
          label={allSettled ? "Done" : "Downloading…"}
          icon={allSettled ? "check" : "download"}
          onPress={onDone}
          // The whole point of the screen: the way out stays shut until there
          // is nothing left that a backgrounded app would break.
          disabled={!allSettled && jobs.length > 0}
        />
      </View>
    </View>
  );
}

/** One in-flight (or stalled) download, with the action its state allows. */
export function DownloadRow({ job }: { job: RegionJob }) {
  const { progress, state, spec } = job;
  const fraction =
    progress.tilesTotal > 0 ? progress.tilesDone / progress.tilesTotal : 0;

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
        ? fraction
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
        isSettled(job) ? null : (
          <View style={styles.rowActions}>
            {state.kind === "downloading" ? (
              <Button
                label="Pause"
                variant="ghost"
                compact
                onPress={() => pauseRegionDownload(spec.id)}
              />
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
  root: { flex: 1, backgroundColor: theme.primary },
  // Fixed, like the download screen's: a pill swapping tone must not shuffle
  // the list underneath it.
  heroNote: { minHeight: 32, justifyContent: "center" },
  list: {
    paddingHorizontal: spacing(2),
    paddingTop: spacing(2),
    paddingBottom: spacing(2),
    gap: spacing(1),
  },
  empty: { color: theme.textMuted, fontSize: fontSize.sm },
  footer: { paddingHorizontal: spacing(2) },
  rowActions: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
});
