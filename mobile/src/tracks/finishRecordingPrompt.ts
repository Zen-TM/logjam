// "Finish recording?" — one confirm, two callers.
//
// The recording can be finished from the sheet's button and from a long press
// on the record button, and the two must ask the same question in the same
// words: a confirm that is worded differently depending on how you got there
// teaches the user to stop reading it (DESIGN.md).
//
// It is also where finishing a recording is REPORTED, because it is the one
// place both callers already funnel through: the one-time "it goes up when you
// have signal" toast, and the "the track is saved but the backup isn't" retry.
//
// PRIVACY: a recording is precise location history. Nothing here logs the
// track's name, its points or the path its GPX was written to — a backup
// failure is reported to the user and logged as a static line.
import { confirm, type ToastMessage } from "../ui";

import { readEntryChoice } from "../auth/guestModePreference";
import {
  markTrackBackupNoticeShown,
  needsTrackBackupNotice,
} from "./recordingPreferences";
import { retryTrackBackup, TrackBackupError } from "./trackBackup";
import {
  discardTrackRecording,
  finishTrackRecording,
  isActiveRecording,
} from "./trackRecorder";
import { getTrack } from "./tracksDb";
import { recordedTrackSource, type TripTrackSource } from "./tripTrackSource";

type Listener = (message: Omit<ToastMessage, "nonce">) => void;
const listeners = new Set<Listener>();

/** Subscribe to what finishing says: BackgroundToast, the only consumer. */
export function onRecordingToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function toast(
  text: string,
  tone: ToastMessage["tone"],
  action?: ToastMessage["action"],
) {
  for (const listener of listeners) listener({ text, tone, action });
}

type LogTripListener = (track: TripTrackSource) => void;
const logTripListeners = new Set<LogTripListener>();

/** Subscribe to "Log a trip" on the finish toast: BackgroundToast opens the form. */
export function onLogTripRequest(listener: LogTripListener): () => void {
  logTripListeners.add(listener);
  return () => logTripListeners.delete(listener);
}

/**
 * Said ONCE, on the first recording that reaches the outbox, so a finished
 * track is not silently "somewhere else". A finish only queues the upload, so
 * the words are about the phone first.
 *
 * Not shown to a guest: they have no account for it to be true of yet. Their
 * queued recordings upload when they link one, and the notice is waiting for
 * the first recording they finish after that.
 */
const SAVED_NOTICE = "Saved on this phone. It goes up when you have signal.";

const isGuest = () => readEntryChoice() === "guest";

function announceSavedOnce(): void {
  if (isGuest()) return;
  if (!needsTrackBackupNotice()) return;
  markTrackBackupNoticeShown();
  toast(SAVED_NOTICE, "done");
}

/**
 * A finished recording says so, and offers the next step: logging the trip.
 * The first one that reaches the outbox says where it went instead, and keeps
 * the offer. A track with no line has nothing to attach, so no offer.
 */
async function announceFinished(trackId: string, queued: boolean) {
  const notice = queued && !isGuest() && needsTrackBackupNotice();
  if (notice) markTrackBackupNoticeShown();
  const track = await getTrack(trackId).catch(() => null);
  const source =
    track && track.pointCount >= 2 ? recordedTrackSource(track) : null;
  toast(
    notice ? SAVED_NOTICE : "Recording saved.",
    "done",
    source
      ? {
          label: "Log a trip",
          onPress: () => {
            for (const listener of logTripListeners) listener(source);
          },
        }
      : undefined,
  );
}

/**
 * The track survived; the copy headed for the account did not. Offers the work
 * again rather than reporting a dead end — `retryTrackBackup` is the same call,
 * and the finished row is untouched by a failure.
 */
function reportBackupFailure(trackId: string): void {
  void confirm({
    confirmTitle: "Track saved, backup didn't start",
    confirmBody:
      "Your recording is safe on this phone. Logjam GPS couldn't copy it to your Logjam account.",
    confirmLabel: "Try again",
    tone: "filled",
  }).then((again) => {
    if (!again) return;
    retryTrackBackup(trackId).then(
      (mediaId) => {
        if (mediaId !== null) announceSavedOnce();
      },
      () => {
        // Static line — never the error, which carries the GPX's path.
        console.warn("track-backup: retry failed");
        reportBackupFailure(trackId);
      },
    );
  });
}

/**
 * Ask, then finish. `onError` takes a failure to show inside the caller's own
 * modal, which would hide a toast; without it the failure is a toast.
 */
export function confirmFinishRecording(
  trackId: string,
  onFinished?: () => void,
  onError?: (message: string) => void,
) {
  void confirm({
    confirmTitle: "Finish recording?",
    confirmBody: "The track is saved on this phone.",
    confirmLabel: "Finish",
    tone: "filled",
  }).then(async (finish) => {
    // Answered after another dialog (a queued Discard) already ended it.
    if (!finish || !(await isActiveRecording(trackId))) return;
    finishTrackRecording(trackId).then(
      (mediaId) => {
        onFinished?.();
        void announceFinished(trackId, mediaId !== null);
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
        const message = "Couldn't save the track.";
        if (onError) onError(message);
        else toast(message, "error");
      },
    );
  });
}

/**
 * Ask, then delete the recording. A discard that fails is reported to
 * `onError`, which the caller shows inside its own modal.
 */
export function confirmDiscardRecording(
  trackId: string,
  onDiscarded: () => void,
  onError: (message: string) => void,
) {
  void confirm({
    confirmTitle: "Discard this recording?",
    confirmBody:
      "Every point recorded so far is deleted. This can't be undone.",
    confirmLabel: "Discard",
    tone: "destructive",
  }).then(async (discard) => {
    // Answered after another dialog (a queued Finish) already ended it: the
    // track is then a finished one, which this question was never about.
    if (!discard || !(await isActiveRecording(trackId))) return;
    // A discard that silently fails to delete leaves the user on a sheet whose
    // subject may still exist, with nothing telling them it didn't work.
    discardTrackRecording(trackId).then(onDiscarded, (err: unknown) => {
      console.error(err);
      onError("Couldn't delete the recording.");
    });
  });
}
