import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { mediaDisplayName, recordingsToLog } from "@logjam/shared";

import type { MirrorMedia } from "../sync/mirrorStore";
import { useStandaloneTrackMedia } from "../tracks/useRemoteTracks";
import { listTracks, type Track } from "../tracks/tracksDb";
import {
  recordedTrackSource,
  syncedTrackSource,
  type TripTrackSource,
} from "../tracks/tripTrackSource";

export type RecordingToLog = TripTrackSource & { key: string };

/**
 * Recordings from the last 30 days on a day with no trip: recorded here, or
 * recorded on another device and synced (listed once when both, as the Saved
 * tab does); a recording with under 2 points has nothing to attach. Day
 * matching is `recordingsToLog`.
 */
export function recordingsToLogFrom(
  tracks: readonly Track[],
  remote: readonly MirrorMedia[],
  trips: readonly { date: string }[],
  today?: Date,
): RecordingToLog[] {
  const local = tracks.filter(
    (track) => track.state === "done" && track.pointCount >= 2,
  );
  const localMediaIds = new Set(local.map((track) => track.mediaId));
  return recordingsToLog(
    [
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
    ],
    trips,
    today,
  );
}

/**
 * Reads the finished recordings when the screen gains focus, NOT through
 * `useTracks`: that re-reads two tables and re-renders its host on every
 * recorder write, and a tab that was visited once stays mounted, so Logs would
 * redraw on every fix of a recording made from the Map tab (ADR 0013). A
 * recording is finished on the Map, so the next focus here sees it.
 */
export function useRecordingsToLog(
  trips: readonly { date: string }[],
): RecordingToLog[] {
  const [tracks, setTracks] = useState<Track[]>([]);
  useFocusEffect(
    useCallback(() => {
      listTracks().then(setTracks).catch(console.error);
    }, []),
  );
  const remote = useStandaloneTrackMedia();
  return useMemo(
    () => recordingsToLogFrom(tracks, remote, trips),
    [tracks, remote, trips],
  );
}
