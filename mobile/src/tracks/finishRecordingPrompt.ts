// "Finish recording?" — one confirm, two callers.
//
// The recording can be finished from the sheet's button and from a long press
// on the record button, and the two must ask the same question in the same
// words: a destructive-adjacent confirm that is worded differently depending on
// how you got there teaches the user to stop reading it (DESIGN.md §7).
import { Alert } from "react-native";

import { finishTrackRecording } from "./trackRecorder";

export function confirmFinishRecording(trackId: string, onFinished?: () => void) {
  Alert.alert("Finish recording?", "The track is saved on this device.", [
    { text: "Keep recording", style: "cancel" },
    {
      text: "Save track",
      onPress: () => {
        finishTrackRecording(trackId).then(
          () => onFinished?.(),
          (err: unknown) => {
            console.error(err);
            Alert.alert("Recording error", "Couldn't save the track.");
          },
        );
      },
    },
  ]);
}
