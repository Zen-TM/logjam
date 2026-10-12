import type { MirrorMedia } from "../sync/mirrorStore";
import { ensureDisplayCached } from "../sync/mediaCache";
import { attachMediaLocal } from "../sync/mediaUpload";
import { attachRecordedTrack } from "./attachRecordedTrack";
import type { Track } from "./tracksDb";

/**
 * A track a trip can be logged FROM ("Log a trip" on a track): what the form
 * needs to open on its day, and how to attach it once the trip exists. One
 * shape for the two ways a track is on this phone, so the trip form does not
 * know which it has:
 *
 *   - recorded here: its points are local, and are written out as a GPX;
 *   - recorded elsewhere (or imported by it): a synced file, whose bytes are
 *     on this phone or fetched once.
 *
 * Attaching a track to a trip is always a COPY of the file (the API links a
 * trip's files, never a way), which is why it needs the bytes.
 */
export type TripTrackSource = {
  name: string;
  /** ISO 8601, or null where the track does not say. */
  startedAt: string | null;
  /** The bytes are not on this phone, so attaching needs a connection. */
  needsConnection: boolean;
  /** Resolves false when the track could not be attached (too few points, a
   *  file that could not be fetched). A local write: the upload follows. */
  attach: (tripId: string) => Promise<boolean>;
};

/** A recording made on this phone. */
export function recordedTrackSource(track: Track): TripTrackSource {
  return {
    name: track.name,
    startedAt: track.startedAt,
    needsConnection: false,
    attach: (tripId) => attachRecordedTrack("tripLog", tripId, track),
  };
}

/** A track in the account (recorded on another device): a synced file. */
export function syncedTrackSource(
  file: Pick<
    MirrorMedia,
    "id" | "filename" | "mediaType" | "metadata" | "localDisplayPath"
  > & { title: string },
): TripTrackSource {
  return {
    name: file.title,
    startedAt: file.metadata.startedAt ?? null,
    needsConnection: file.localDisplayPath === null,
    attach: async (tripId) => {
      // Cached already, or fetched once and cached: null offline.
      const uri = await ensureDisplayCached(file.id);
      if (!uri) return false;
      await attachMediaLocal("tripLog", tripId, {
        uri,
        mimeType: file.mediaType,
        fileName: file.filename ?? `${file.title}.gpx`,
      });
      return true;
    },
  };
}
