import { useMemo } from "react";
import { distinctTripTypes } from "@logjam/shared";

import { TripEditSheet } from "../logs/TripEditSheet";
import { useConnectivity } from "../map/connectivity";
import { useMirrorPlaces, useMirrorTrips } from "../sync/useSyncQueries";
import type { Track } from "./tracksDb";

/**
 * The trip form, opened from a recorded track's "Log a trip": the same
 * `TripEditSheet` as everywhere (shared/DESIGN.md §10), on the track's day and
 * with the track attached.
 *
 * Its own component so every surface that mounts `TrackOptionsSheet` (the map
 * and Saved) mounts the form the same way, with the data the form needs read
 * from the mirror here, not threaded through each of them.
 */
export function LogTripFromTrackSheet({
  track,
  onClose,
  onSaved,
}: {
  /** Null while closed. */
  track: Track | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const online = useConnectivity() === "online";
  const places = useMirrorPlaces();
  const trips = useMirrorTrips();
  const existingTypes = useMemo(
    () => distinctTripTypes(trips.data ?? []),
    [trips.data],
  );
  return (
    <TripEditSheet
      online={online}
      visible={track !== null}
      places={places.data ?? []}
      fromTrack={track}
      existingTypes={existingTypes}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
