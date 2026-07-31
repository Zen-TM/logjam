// Recording HUD — live stats and the controls, while a track is recording or
// paused. The start button lives in the map's control column; from the moment
// recording begins this panel is the only thing that steers it.
//
// It is a LAYOUT-FREE component: the map owns where it sits. That is now the
// TOP notice stack rather than the bottom edge — the bottom belongs to the
// native compass, the scale bar and the two floating columns, and a panel that
// pushed those around left them shoved up the screen after recording ended.
//
// Anatomy: the elapsed clock is the headline (it is the number you glance at
// while walking), distance and ascent ride beside it as labelled stats, and the
// three controls sit on their own row so none of them is a mis-tap away from
// another.
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
      <View style={styles.readout}>
        <View style={styles.clockBlock}>
          {/* A filled dot while live, a hollow one while paused — the state is
              readable at a glance without reading the word. */}
          <View style={styles.state}>
            <View style={[styles.dot, recording ? styles.dotLive : styles.dotPaused]} />
            <Text style={[styles.stateText, !recording && styles.stateTextPaused]}>
              {recording ? "Recording" : "Paused"}
            </Text>
          </View>
          <Text style={styles.clock}>{formatDurationMs(activeTrack.durationMs)}</Text>
        </View>
        <View style={styles.stats}>
          <Stat label="Distance" value={formatDistanceM(activeTrack.distanceM)} />
          <Stat label="Ascent" value={`${Math.round(activeTrack.elevationGainM)} m`} />
        </View>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
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
  readout: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing(1),
  },
  clockBlock: { gap: spacing(0.25) },
  state: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotLive: { backgroundColor: theme.warning },
  dotPaused: {
    borderWidth: 2,
    borderColor: theme.textMuted,
  },
  stateText: {
    color: theme.warning,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  stateTextPaused: { color: theme.textMuted },
  clock: {
    color: theme.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    // Tabular-ish: a proportional clock jiggles its own width every second.
    fontVariant: ["tabular-nums"],
  },
  stats: { flexDirection: "row", gap: spacing(2) },
  stat: { alignItems: "flex-end", gap: spacing(0.25) },
  statLabel: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  statValue: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  spacer: { flex: 1 },
});
