// "Finish recording?" — one confirm, two callers.
//
// The recording can be finished from the sheet's button and from a long press
// on the record button, and the two must ask the same question in the same
// words: a destructive-adjacent confirm that is worded differently depending on
// how you got there teaches the user to stop reading it (DESIGN.md §7).
//
// It is also where finishing a recording is REPORTED, because it is the one
// place both callers already funnel through: the one-time "this is backed up
// now" notice, and the "the track is saved but the backup isn't" retry.
//
// PRIVACY: a recording is precise location history. Nothing here logs the
// track's name, its points or the path its GPX was written to — a backup
// failure is reported to the user and logged as a static line.
import { Alert } from "react-native";

import { readEntryChoice } from "../auth/guestModePreference";
import {
  markTrackBackupNoticeShown,
  needsTrackBackupNotice,
} from "./recordingPreferences";
import { retryTrackBackup, TrackBackupError } from "./trackBackup";
import { finishTrackRecording } from "./trackRecorder";

/**
 * Said ONCE, on the first recording that actually reaches the account.
 *
 * Recording location is the most sensitive thing this app holds and it used to
 * stay on the handset, so the change is stated rather than switched on quietly.
 * Short and factual on purpose: it is not a consent dialog with a way out (the
 * user can delete the file), it is a statement of where their track now lives.
 *
 * Not shown to a guest: they have no account for it to be true of yet. Their
 * queued recordings upload when they link one, and the notice is waiting for
 * the first recording they finish after that.
 */
const BACKUP_NOTICE_TITLE = "Recordings are backed up";
const BACKUP_NOTICE_BODY =
  "This track is now saved to your Logjam account, not just this phone. " +
  "It's backed up there, and it appears on your other devices signed in to Logjam GPS.";

function announceBackupOnce(): void {
  if (readEntryChoice() === "guest") return;
  if (!needsTrackBackupNotice()) return;
  markTrackBackupNoticeShown();
  Alert.alert(BACKUP_NOTICE_TITLE, BACKUP_NOTICE_BODY, [{ text: "Got it" }]);
}

/**
 * The track survived; the copy headed for the account did not. Offers the work
 * again rather than reporting a dead end — `retryTrackBackup` is the same call,
 * and the finished row is untouched by a failure.
 */
function reportBackupFailure(trackId: string): void {
  Alert.alert(
    "Track saved, backup didn't start",
    "Your recording is safe on this phone. Logjam GPS couldn't copy it to your Logjam account.",
    [
      { text: "Not now", style: "cancel" },
      {
        text: "Try again",
        onPress: () => {
          retryTrackBackup(trackId).then(
            (mediaId) => {
              if (mediaId !== null) announceBackupOnce();
            },
            () => {
              // Static line — never the error, which carries the GPX's path.
              console.warn("track-backup: retry failed");
              reportBackupFailure(trackId);
            },
          );
        },
      },
    ],
  );
}

export function confirmFinishRecording(trackId: string, onFinished?: () => void) {
  Alert.alert("Finish recording?", "The track is saved on this device.", [
    { text: "Keep recording", style: "cancel" },
    {
      text: "Save track",
      onPress: () => {
        finishTrackRecording(trackId).then(
          (mediaId) => {
            onFinished?.();
            if (mediaId !== null) announceBackupOnce();
          },
          (err: unknown) => {
            if (err instanceof TrackBackupError) {
              // The recording itself finished — the sheet must close on it, or
              // the user is left looking at a live-looking recorder that isn't.
              onFinished?.();
              console.warn("track-backup: could not queue the finished recording");
              reportBackupFailure(trackId);
              return;
            }
            console.error(err);
            Alert.alert("Recording error", "Couldn't save the track.");
          },
        );
      },
    },
  ]);
}
