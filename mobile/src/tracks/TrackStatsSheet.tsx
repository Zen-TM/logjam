// What a recorded track IS, shown when one is tapped on the map.
//
// The mobile counterpart of RouteStatsSheet, and deliberately its twin: a
// track reached from the map must not be a lesser object than a route reached
// the same way (DESIGN.md §7). Read-only, with every verb one tap further on
// behind "View options", so tapping a line can never be the first half of an
// accidental delete.
//
// Unlike a route's profile, nothing here needs the network or the DEM: a
// recording carries its own altitudes, so the whole panel works in a canyon
// with no signal.
import { StyleSheet, View } from "react-native";

import { spacing } from "../theme";
import { BottomSheet, Button } from "../ui";
import { TrackStatsBody } from "./TrackStatsBody";
import type { Track } from "./tracksDb";
import { useTrackDetail } from "./useTrackDetail";

export function TrackStatsSheet({
  track,
  visible,
  onClose,
  onViewOptions,
}: {
  track: Track | null;
  visible: boolean;
  onClose: () => void;
  onViewOptions: () => void;
}) {
  // Hooks run before the early return — a null track reads nothing.
  const { detail, loading } = useTrackDetail(
    track?.id ?? null,
    visible && track != null,
  );
  if (!track) return null;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={track.name}>
      <View style={styles.body}>
        {/* The stored duration, not the series': a track's recording time is
            wall-clock minus pauses, and the point-derived span stops at the
            last accepted fix (see `recordedDurationMs`). */}
        <TrackStatsBody
          detail={detail}
          loading={loading}
          elapsedMs={track.durationMs}
        />
        <Button label="View options" icon="more-horizontal" onPress={onViewOptions} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1.5) },
});
