// Measure HUD — running totals for the tapped points, plus undo/clear/done.
//
// LAYOUT-FREE like TrackRecordingControls: the map owns where it sits (the top
// notice stack), and it wears the same surface treatment so the chrome over the
// map reads as one family.
//
// Distance is the primary readout — it is the number the tool exists for, and
// it needs no data beyond the taps, so it is always right.
//
// Ascent/descent are back, but on a different footing than the contour-derived
// heights that were removed (see measure.ts): they are DERIVED ON DEMAND from
// the tapped points plus the DEM, never stored on a point, and they are absent
// rather than wrong when there is no signal.
import { StyleSheet, Text, View } from "react-native";
import { formatDistanceM } from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";
import { Button, IconButton } from "../ui";
import { ElevationReadout } from "./ElevationReadout";
import { useElevationProfile } from "./useElevationProfile";
import { measureStats, type MeasurePoint } from "./measure";

export function MeasurePanel({
  points,
  onUndo,
  onClear,
  onDone,
}: {
  points: readonly MeasurePoint[];
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const stats = measureStats(points);
  const line = points.map(
    (point) => [point.longitude, point.latitude] as [number, number],
  );
  const { profile, loading } = useElevationProfile(line);
  return (
    <View style={styles.panel}>
      <View style={styles.readout}>
        <View style={styles.headline}>
          <Text style={styles.label}>
            {points.length === 0
              ? "Tap the map to measure"
              : `${points.length} point${points.length === 1 ? "" : "s"}`}
          </Text>
          <Text style={styles.distance}>{formatDistanceM(stats.distanceM)}</Text>
        </View>
      </View>

      <ElevationReadout profile={profile} loading={loading} />

      <View style={styles.actions}>
        <Button
          label="Undo"
          icon="corner-up-left"
          variant="outlineAccent"
          compact
          disabled={points.length === 0}
          onPress={onUndo}
        />
        <Button label="Done" icon="check" compact onPress={onDone} />
        <View style={styles.spacer} />
        <IconButton
          icon="trash-2"
          color={theme.warning}
          accessibilityLabel="Clear the measurement"
          onPress={onClear}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: withAlpha(theme.primary, 0.94),
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: withAlpha(theme.accent, 0.4),
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1.25),
    gap: spacing(1),
  },
  readout: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing(1),
  },
  headline: { gap: spacing(0.25), flexShrink: 1 },
  label: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  distance: {
    color: theme.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    fontVariant: ["tabular-nums"],
  },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  spacer: { flex: 1 },
});
