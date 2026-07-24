// Recording HUD (Stage 7): visible while a track is recording/paused —
// live stats + pause/resume/finish/discard. The start button lives in
// MapScreen's control column.
import { useCallback } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { formatDistanceM, formatDurationMs } from "@logjam/shared";

import { fontSize, radius, spacing, theme } from "../theme";
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
      { text: "Cancel", style: "cancel" },
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
      "Discard recording?",
      "The recorded points are deleted. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
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
        <Text style={[styles.state, recording ? styles.stateRec : styles.statePaused]}>
          {recording ? "● REC" : "❚❚ Paused"}
        </Text>
        <Text style={styles.stats}>
          {formatDistanceM(activeTrack.distanceM)} ·{" "}
          {formatDurationMs(activeTrack.durationMs)} · ↑
          {Math.round(activeTrack.elevationGainM)} m
        </Text>
      </View>
      <View style={styles.buttonRow}>
        <Pressable accessibilityRole="button" onPress={handlePauseResume}>
          <Text style={styles.action}>{recording ? "Pause" : "Resume"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={handleFinish}>
          <Text style={styles.action}>Finish</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={handleDiscard}>
          <Text style={styles.discard}>Discard</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    left: spacing(2),
    bottom: spacing(5),
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: radius.md,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    gap: spacing(0.5),
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing(1.5) },
  state: { fontSize: fontSize.sm, fontWeight: "700" },
  stateRec: { color: theme.warning },
  statePaused: { color: theme.textMuted },
  stats: { color: theme.textPrimary, fontSize: fontSize.sm },
  buttonRow: { flexDirection: "row", gap: spacing(3) },
  action: { color: theme.accent, fontSize: fontSize.sm, fontWeight: "600" },
  discard: { color: theme.warning, fontSize: fontSize.sm, fontWeight: "600" },
});
