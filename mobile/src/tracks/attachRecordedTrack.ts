import * as FileSystem from "expo-file-system/legacy";
import { trackPointsToGpx } from "@logjam/shared";

import { scratchFileUri } from "../offline/localStores";
import { attachMediaLocal } from "../sync/mediaUpload";
import { listTrackPoints, type Track } from "./tracksDb";

/**
 * Attach a recording to a place or a trip as a GPX file. A local write: the
 * file is queued for upload, so it works with no signal.
 *
 * Shared by the attachment strip ("From a recorded track") and the trip form
 * ("Log a trip" on a track), so the two cannot disagree about what an attached
 * recording is.
 *
 * A GPX of a recorded track is the densest coordinate artefact this app
 * produces — a timestamped trace of a whole descent. It is scratch: it exists
 * only until `attachMediaLocal` has copied it into media-cache/, so it goes in
 * the wiped scratch dir AND is deleted here (the GeoPDF pipeline's contract).
 *
 * Resolves false for a recording with too few points to be a line; throws on a
 * failure, with an error whose message may carry the track's name, so a caller
 * says its own words.
 */
export async function attachRecordedTrack(
  linkedType: "place" | "tripLog",
  linkedId: string,
  track: Pick<Track, "id" | "name">,
): Promise<boolean> {
  let scratch: string | null = null;
  try {
    const points = await listTrackPoints(track.id);
    if (points.length < 2) return false;
    // Written out as GPX, the shape both clients already read: the attachment
    // shows on the web trip and on the map, and the file is one the user can
    // open anywhere. The local recording is left untouched.
    scratch = await scratchFileUri(`${track.id}.gpx`);
    await FileSystem.writeAsStringAsync(
      scratch,
      trackPointsToGpx(track.name, points),
    );
    await attachMediaLocal(linkedType, linkedId, {
      uri: scratch,
      mimeType: "application/gpx+xml",
      fileName: `${track.name}.gpx`,
    });
    return true;
  } finally {
    if (scratch) {
      await FileSystem.deleteAsync(scratch, { idempotent: true }).catch(
        console.error,
      );
    }
  }
}
