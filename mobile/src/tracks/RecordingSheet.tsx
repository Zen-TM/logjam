// The live recording's numbers and its verbs, behind a tap on the record
// button.
//
// It used to be a card pinned to the map's top notice stack for the whole trip.
// The card said four things, three of which nobody reads while walking — what
// a person actually wants from a recording in progress is the knowledge that it
// IS in progress, and that is now the record button's pulse (RecordButton).
// Everything else moved in here, where it costs no map at all and can therefore
// afford to be longer than four numbers.
//
// The controls sit in the sheet's `footer` rather than in the scroll: with two
// profile charts the body can outgrow the 80% cap, and a Finish button that
// scrolls away leaves the drag handle as the only exit — which means DISCARD
// (DESIGN.md §6).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Alert, AppState, StyleSheet, Text, View } from "react-native";

import { ensureForegroundLocationPermission } from "../map/locationPermission";
import { useElevationProfile } from "../map/useElevationProfile";
import { fontSize, fontWeight, spacing, theme } from "../theme";
import { BottomSheet, Button, IconButton } from "../ui";
import { confirmFinishRecording } from "./finishRecordingPrompt";
import { TrackStatsBody } from "./TrackStatsBody";
import {
  discardTrackRecording,
  pauseTrackRecording,
  resumeTrackRecording,
  trackDurationMs,
} from "./trackRecorder";
import type { Track } from "./tracksDb";
import {
  isRecordingWriteFailing,
  onTrackWriteHealthChanged,
} from "./trackWriteQueue";
import { useTrackDetail } from "./useTrackDetail";

export function RecordingSheet({
  activeTrack,
  visible,
  onClose,
  allowNetwork = true,
}: {
  activeTrack: Track | null;
  visible: boolean;
  onClose: () => void;
  /** False in "Simulating offline mode": heights then come only from tiles
   *  already on the phone, and nothing goes out. */
  allowNetwork?: boolean;
}) {
  const recording = activeTrack?.state === "recording";
  const open = visible && activeTrack != null;

  // A recorder that cannot write must not present as one that is writing: the
  // clock keeps ticking off the wall clock whether or not points reach SQLite,
  // so a run of failed batch writes is said out loud here (MLIFE-001). The map
  // says it too, in the notice stack, because this sheet is closed most of the
  // time and that warning must not wait to be found.
  const writeFailing = useSyncExternalStore(
    onTrackWriteHealthChanged,
    isRecordingWriteFailing,
  );

  // The clock ticks on its own second, not on the arrival of a fix batch. The
  // stored durationMs only moves when a batch lands, so on good GPS while
  // standing still the headline number used to sit frozen and then jump.
  const [elapsedMs, setElapsedMs] = useState(0);
  // It runs only while the sheet is OPEN and the app is in the FOREGROUND. It
  // is derived from the wall clock, so nothing is lost by stopping it — the
  // recomputation on return is exact — and a recording is the one thing in this
  // app that runs for hours with the screen off: a 1 Hz timer through all of it
  // is thousands of wakeups nobody can see the result of. (Before the panel
  // existed this ran whenever a recording did, which was strictly worse.)
  useEffect(() => {
    if (!open || activeTrack == null) return;
    const tick = () => setElapsedMs(trackDurationMs(activeTrack, null));
    tick();
    if (!recording) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null) return;
      tick();
      timer = setInterval(tick, 1000);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") start();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else stop();
    });
    return () => {
      subscription.remove();
      stop();
    };
  }, [activeTrack, recording, open]);

  // Below the clock on purpose: the detail folds `elapsedMs` in so the time
  // since the last accepted fix is counted as stopped rather than as nothing
  // (computeTrackDetail's `recordedMs`). Standing still is exactly when this
  // panel gets opened, and it is the case where the two disagree most.
  const { detail, loading, line } = useTrackDetail(
    activeTrack?.id ?? null,
    open,
    elapsedMs,
  );
  // Heights from the terrain rather than from the phone's altimeter, on the
  // same terms as a drawn route: saved tiles first, then our API, then the
  // public ones. The line is republished on a throttle (useTrackDetail), so a
  // running recording does not re-sample the DEM on every written batch.
  const { profile: demProfile, loading: demLoading } = useElevationProfile(line, {
    allowNetwork,
  });

  const handlePauseResume = useCallback(() => {
    if (!activeTrack) return;
    const work = async () => {
      if (recording) {
        await pauseTrackRecording(activeTrack.id);
        return;
      }
      // Resuming arms the location service again, and the permission can have
      // been revoked while the recording was paused (Android 12+ auto-revoke,
      // or the user changing it in settings). Ask the same way starting does —
      // that alert names the problem and offers system settings, where the
      // generic error below reads as "the pause button glitched".
      if (!(await ensureForegroundLocationPermission())) return;
      await resumeTrackRecording(activeTrack);
    };
    work().catch((err: unknown) => {
      console.error(err);
      Alert.alert("Recording error", "Couldn't change the recording state.");
    });
  }, [activeTrack, recording]);

  const handleFinish = useCallback(() => {
    if (!activeTrack) return;
    confirmFinishRecording(activeTrack.id, onClose);
  }, [activeTrack, onClose]);

  const handleDiscard = useCallback(() => {
    if (!activeTrack) return;
    const trackId = activeTrack.id;
    Alert.alert(
      "Discard this recording?",
      "Every point recorded so far is deleted. This can't be undone.",
      [
        { text: "Keep recording", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            discardTrackRecording(trackId).then(
              () => onClose(),
              (err: unknown) => console.error(err),
            );
          },
        },
      ],
    );
  }, [activeTrack, onClose]);

  if (!activeTrack) return null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={recording ? "Recording" : "Recording paused"}
      footer={
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
      }
    >
      <View style={styles.body}>
        {writeFailing ? (
          <Text style={styles.writeWarning}>
            Points aren&apos;t being saved — this phone&apos;s storage is
            refusing writes. Finish and check free space.
          </Text>
        ) : null}
        <TrackStatsBody
          detail={detail}
          loading={loading}
          elapsedMs={elapsedMs}
          demProfile={demProfile}
          demLoading={demLoading}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1.5) },
  writeWarning: {
    color: theme.warning,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  spacer: { flex: 1 },
});
