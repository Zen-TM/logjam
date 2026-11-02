import { useMemo } from "react";
import { mediaDisplayName, recordingsToLog } from "@logjam/shared";

import { useStandaloneTrackMedia } from "../tracks/useRemoteTracks";
import { useTracks } from "../tracks/useTracks";
import {
  recordedTrackSource,
  syncedTrackSource,
  type TripTrackSource,
} from "../tracks/tripTrackSource";

/**
 * Recordings from the last 30 days on a day with no trip: recorded here, or
 * recorded on another device and synced (listed once when both, as the Saved
 * tab does). Day matching is `recordingsToLog`.
 */
export function useRecordingsToLog(
  trips: readonly { date: string }[],
): (TripTrackSource & { key: string })[] {
  const { tracks } = useTracks();
  const remote = useStandaloneTrackMedia();
  return useMemo(() => {
    const local = tracks.filter(
      (track) => track.state === "done" && track.pointCount >= 2,
    );
    const localMediaIds = new Set(local.map((track) => track.mediaId));
    const all = [
      ...local.map((track) => ({
        key: track.id,
        ...recordedTrackSource(track),
      })),
      ...remote
        .filter((file) => !localMediaIds.has(file.id))
        .map((file) => ({
          key: file.id,
          ...syncedTrackSource({ ...file, title: mediaDisplayName(file) }),
        })),
    ];
    return recordingsToLog(all, trips);
  }, [tracks, remote, trips]);
}
