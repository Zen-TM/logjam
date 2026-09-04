// A finished recording becomes a standalone file on the account: the points are
// serialised to GPX, the file is written into `RECORDED_TRACK_DIR`, and a media
// row with `origin: "track"` carries it up through the ordinary three-phase
// upload. That is what makes a recording survive a lost phone and show up on
// the user's other devices — until now a track lived and died on the handset
// that made it.
//
// THE LOCAL TABLES STAY. `track` + `track_point` are the recorder's own store
// and remain the source of the map line and every stat; the media row is a copy
// that syncs. `track.mediaId` is the join between them, so nothing has to show
// one trip as two things.
//
// PRIVACY: the GPX IS precise location history — the most sensitive data the
// app holds (tracksDb.ts's header). Nothing here logs a coordinate, a bbox, a
// track name, a filename or a path; failures are reported as state, and the
// error itself is handed to the caller rather than printed.
import * as FileSystem from "expo-file-system/legacy";
import {
  GPX_MIME_TYPE,
  exportFilename,
  parseMediaMetadata,
  trackPointsToGpx,
  type MediaMetadata,
  type RecordedTrackPoint,
} from "@logjam/shared";

import { RECORDED_TRACK_DIR } from "../offline/localStores";
import { bboxOfPoints } from "../saved/bboxOfPoints";
import { createStandaloneMediaLocal, deleteMediaLocal } from "../sync/mediaUpload";
import { getMediaById } from "../sync/mirrorStore";
import {
  getTrack,
  listTrackPoints,
  listTracksNeedingBackup,
  updateTrack,
  type Track,
} from "./tracksDb";

/**
 * The backup failed; the RECORDING DID NOT. Thrown only after the track row is
 * safely finished, so a caller catching this knows the trip is intact and that
 * the one thing left to do is retry (`retryTrackBackup`).
 *
 * A distinct class rather than a flag on a result object because an unhandled
 * error is loud and an unread field is not.
 */
export class TrackBackupError extends Error {
  constructor(cause: unknown) {
    super("Could not back this recording up.");
    this.name = "TrackBackupError";
    this.cause = cause;
  }
}

/**
 * The stats the media row carries, built from the recorder's OWN numbers rather
 * than re-derived from the serialised GPX: the GPX has no record of the pauses
 * or of the fixes the acceptance filter refused, so a reader would measure a
 * different trip.
 *
 * Validated here through the same `parseMediaMetadata` the API runs on the
 * write. Every field is required server-side and a negative one is a 400, so
 * without this a bad number would leave a media op parked in the outbox with
 * nothing pointing at the cause — a failure at the finish tap, where it can be
 * retried, is worth more than one three sync cycles later.
 */
export function trackBackupMetadata(
  track: Track,
  points: RecordedTrackPoint[],
): MediaMetadata {
  const bbox = bboxOfPoints(points);
  if (bbox === null) throw new Error("A recording with no points has no extent");
  if (track.endedAt === null) throw new Error("This recording has not finished");
  return parseMediaMetadata("track", {
    bbox,
    distanceM: track.distanceM,
    durationMs: track.durationMs,
    elevationGainM: track.elevationGainM,
    elevationLossM: track.elevationLossM,
    pointCount: points.length,
    startedAt: track.startedAt,
    endedAt: track.endedAt,
  });
}

/**
 * Serialise a finished track, register it as a standalone file, and record the
 * media id on the track row. Returns the new media id, or null when there is
 * nothing to back up (a recording that accepted no fixes has no extent, and an
 * empty GPX is not worth an upload).
 *
 * `track.mediaId` already set means this recording was backed up and then
 * CONTINUED (`continueTrackRecording`) — the stored file is now half a trip.
 * The new file is created first and the stale row deleted after, so a failure
 * on the way cannot leave the account with no copy at all.
 *
 * Throws `TrackBackupError` and leaves nothing behind: a GPX whose media row
 * was never written is deleted, so a retry never has to reason about a file
 * from a previous attempt.
 */
export async function backUpFinishedTrack(
  track: Track,
  points: RecordedTrackPoint[],
): Promise<string | null> {
  if (points.length === 0) return null;
  let filePath: string | null = null;
  let registeredMediaId: string | null = null;
  try {
    const metadata = trackBackupMetadata(track, points);
    const finishedAt = track.endedAt;
    if (finishedAt === null) throw new Error("This recording has not finished");
    // Named for the track and the finish it belongs to, so a re-finish after
    // `continueTrackRecording` writes a NEW file: reusing the path would have
    // the previous row's pending delete take the new row's bytes with it.
    filePath = `${RECORDED_TRACK_DIR}${track.id}-${Date.parse(finishedAt)}.gpx`;
    await FileSystem.makeDirectoryAsync(RECORDED_TRACK_DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(filePath, trackPointsToGpx(track.name, points), {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const mediaId = await createStandaloneMediaLocal({
      filePath,
      filename: exportFilename(track.name, "gpx", "track"),
      mediaType: GPX_MIME_TYPE,
      origin: "track",
      displayName: track.name,
      metadata,
      color: track.color,
    });
    registeredMediaId = mediaId;
    const superseded = track.mediaId === null ? null : await getMediaById(track.mediaId);
    if (superseded) await deleteMediaLocal(superseded);
    await updateTrack(track.id, { mediaId });
    return mediaId;
  } catch (error) {
    // No half-written file: nothing would ever delete it and nothing could
    // ever upload it. Only while no media row owns it, though — past that
    // point the file is a queued upload's body, and deleting it would turn a
    // recoverable failure into a media row that can never be sent.
    if (filePath && registeredMediaId === null) {
      await FileSystem.deleteAsync(filePath, { idempotent: true }).catch(() => {});
    }
    throw new TrackBackupError(error);
  }
}

/**
 * Retry a backup that failed. The track row is untouched by a failure, so the
 * retry is just the same call again, and it is safe to run on a track that
 * already succeeded (it re-serialises and supersedes).
 *
 * Also what `sweepTrackBackups` calls, so the two paths cannot diverge.
 */
export async function retryTrackBackup(trackId: string): Promise<string | null> {
  const track = await getTrack(trackId);
  if (!track || track.state !== "done") return null;
  return backUpFinishedTrack(track, await listTrackPoints(trackId));
}

/**
 * Register every finished recording that has no account copy yet.
 *
 * The finish-time backup can fail — a full disk, a write refused, a media row
 * the outbox would not take — and the alert it raises offers "Try again". A
 * user who taps "Not now" was, until this existed, the end of the story: that
 * recording was never backed up and nothing ever mentioned it again. A silent
 * hole exactly where the feature's whole promise is, which is not something a
 * dismissible dialog should be the only guard for.
 *
 * NO METERED GATE HERE, deliberately. This writes a GPX and a mirror row; the
 * bytes leave the phone through the ordinary media outbox, which already checks
 * `canRunNow("mediaUpload")` before its PUTs (mediaUpload.ts). Gating here as
 * well would delay the one step whose failure this exists to recover from, to
 * no benefit — the upload waits for Wi-Fi either way.
 *
 * STOPS ON THE FIRST FAILURE rather than working the list. If registration is
 * failing it is failing for a reason that applies to all of them (no disk, no
 * directory), and grinding through would write and delete a file per track for
 * nothing. The next cycle tries again from the top.
 *
 * Returns how many it registered, for the caller's log line — never a name, a
 * path or a count of points.
 */
export async function sweepTrackBackups(): Promise<number> {
  const owed = await listTracksNeedingBackup();
  let registered = 0;
  for (const track of owed) {
    try {
      const mediaId = await backUpFinishedTrack(track, await listTrackPoints(track.id));
      if (mediaId !== null) registered += 1;
    } catch {
      // The recording is intact — `backUpFinishedTrack` only throws after the
      // track row is safely finished — so there is nothing to repair, and the
      // next cycle will find this track still owed.
      break;
    }
  }
  return registered;
}
