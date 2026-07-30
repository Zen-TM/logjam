// Recording HUD — live stats and the controls, while a track is recording or
// paused. The start button lives in the map's control column; from the moment
// recording begins this panel is the only thing that steers it.
//
// It is a LAYOUT-FREE component: the map owns where chrome sits, because the
// floating button columns have to lift out of its way and only the map knows how
// tall it turned out (see `hudHeight` in MapScreen). The previous version pinned
// itself to the bottom-left and sat on top of the compass, the attribution
// button and the scale bar.
import { useCallback } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { formatDistanceM, formatDurationMs } from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";
import { Button, IconButton } from "../ui";
import {
  discardTrackRecording,
  finishTrackRecording,
  pauseTrackRecording,
  resumeTrackRecording,
} from "./trackRecorder";
import type { Track } from "./tracksDb";

export function TrackRecordingControls({ activeTrack }: { activeTrack: Track }) {
  const recording = activeTrack.state === "recording";

  const handlePauseResume = useCallback(() => {
    (recording
      ? pauseTrackRecording(activeTrack.id)
      : resumeTrackRecording(activeTrack)
    ).catch((err) => {
      console.error(err);
      Alert.alert("Recording error", "Couldn't change the recording state.");
    });
  }, [activeTrack, recording]);

  const handleFinish = useCallback(() => {
    Alert.alert("Finish recording?", "The track is saved on this device.", [
      { text: "Keep recording", style: "cancel" },
      {
        text: "Save track",
        onPress: () => {
          finishTrackRecording(activeTrack.id).catch((err) => {
            console.error(err);
            Alert.alert("Recording error", "Couldn't save the track.");
          });
        },
      },
    ]);
  }, [activeTrack.id]);

  const handleDiscard = useCallback(() => {
    Alert.alert(
      "Discard this recording?",
      "Every point recorded so far is deleted. This can't be undone.",
      [
        { text: "Keep recording", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            discardTrackRecording(activeTrack.id).catch(console.error);
          },
        },
      ],
    );
  }, [activeTrack.id]);

  return (
    <View style={styles.panel}>
      <View style={styles.statusRow}>
        {/* A filled dot while live, a hollow one while paused — the state is
            readable at a glance without reading the word. */}
        <View style={styles.state}>
          <View style={[styles.dot, recording ? styles.dotLive : styles.dotPaused]} />
          <Text style={[styles.stateText, !recording && styles.stateTextPaused]}>
            {recording ? "Recording" : "Paused"}
          </Text>
        </View>
        <Text style={styles.stats} numberOfLines={1}>
          {formatDistanceM(activeTrack.distanceM)}
          {" · "}
          {formatDurationMs(activeTrack.durationMs)}
          {" · ↑ "}
          {Math.round(activeTrack.elevationGainM)} m
        </Text>
      </View>
      <View style={styles.actions}>
        <Button
          label={recording ? "Pause" : "Resume"}
          icon={recording ? "pause" : "play"}
          variant="outlineAccent"
          compact
          onPress={handlePauseResume}
        />
        <Button label="Finish" icon="check" compact onPress={handleFinish} />
        <View style={styles.spacer} />
        <IconButton
          icon="trash-2"
          color={theme.warning}
          accessibilityLabel="Discard this recording"
          onPress={handleDiscard}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same surface treatment as the map's other badges: the page colour at high
  // alpha with an accent hairline, so chrome over the map reads as one family.
  panel: {
    backgroundColor: withAlpha(theme.primary, 0.94),
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: withAlpha(theme.accent, 0.4),
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1.25),
    gap: spacing(1),
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing(1),
  },
  state: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotLive: { backgroundColor: theme.warning },
  dotPaused: {
    borderWidth: 2,
    borderColor: theme.textMuted,
  },
  stateText: {
    color: theme.warning,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  stateTextPaused: { color: theme.textMuted },
  stats: {
    flex: 1,
    textAlign: "right",
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  spacer: { flex: 1 },
});
