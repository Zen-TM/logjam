// Measure HUD — running totals for the tapped points, plus undo/clear/done.
//
// LAYOUT-FREE like TrackRecordingControls: the map owns where it sits (the top
// notice stack), and it wears the same surface treatment so the chrome over the
// map reads as one family.
//
// Distance is the headline — it is the number the tool exists for. Ascent and
// descent ride beside it, and say "—" rather than "0 m" when no contour was
// found under the taps, because a confident zero is a lie about unknown ground
// (see the elevation ceiling in measure.ts).
import { StyleSheet, Text, View } from "react-native";
import { formatDistanceM } from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";
import { Button, IconButton } from "../ui";
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
        <View style={styles.stats}>
          <Stat label="Ascent" value={heightText(stats.gainM)} />
          <Stat label="Descent" value={heightText(stats.lossM)} />
        </View>
      </View>

      {/* Says WHY the heights are missing, so "—" doesn't read as a bug. The
          only place in the app that explains the contour-derived ceiling. */}
      {points.length >= 2 && !stats.elevationComplete ? (
        <Text style={styles.note}>
          Heights come from contour lines — turn on a vector topo overlay to
          measure climb.
        </Text>
      ) : null}

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

function heightText(metres: number | null): string {
  return metres == null ? "—" : `${Math.round(metres)} m`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
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
  stats: { flexDirection: "row", gap: spacing(2) },
  stat: { alignItems: "flex-end", gap: spacing(0.25) },
  statLabel: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  statValue: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  note: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  spacer: { flex: 1 },
});
