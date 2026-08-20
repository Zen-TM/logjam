// What a recorded track IS, shown when one is tapped on the map.
//
// The mobile counterpart of RouteStatsSheet, and deliberately its twin: a
// track reached from the map must not be a lesser object than a route reached
// the same way (DESIGN.md §7). Read-only, with every verb one tap further on
// behind "View options", so tapping a line can never be the first half of an
// accidental delete.
//
// Heights come from the DEM where anything can answer, and fall back to the
// recording's own GPS altitudes where nothing can — so the panel still works in
// a canyon with no signal and no saved tiles, and says which it is showing.
import { StyleSheet, View } from "react-native";

import { spacing } from "../theme";
import { useElevationProfile } from "../map/useElevationProfile";
import { BottomSheet, Button } from "../ui";
import { TrackStatsBody } from "./TrackStatsBody";
import type { Track } from "./tracksDb";
import { useTrackDetail } from "./useTrackDetail";

export function TrackStatsSheet({
  track,
  visible,
  onClose,
  onViewOptions,
  allowNetwork = true,
}: {
  track: Track | null;
  visible: boolean;
  onClose: () => void;
  onViewOptions: () => void;
  /** False in "Simulating offline mode" — saved tiles only. */
  allowNetwork?: boolean;
}) {
  // Hooks run before the early return — a null track reads nothing.
  const { detail, loading, line } = useTrackDetail(
    track?.id ?? null,
    visible && track != null,
    track?.durationMs,
  );
  const { profile: demProfile, loading: demLoading } = useElevationProfile(line, {
    allowNetwork,
  });
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
          demProfile={demProfile}
          demLoading={demLoading}
        />
        <Button label="View options" icon="more-horizontal" onPress={onViewOptions} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1.5) },
});
