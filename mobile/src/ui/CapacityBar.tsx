import { StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";

export type CapacitySegment = {
  /** Legend text. */
  label: string;
  /** Any additive quantity — bytes, counts, minutes. Zero-value segments are dropped. */
  value: number;
  /** Segment + legend-dot colour (an `assetHue`). */
  color: string;
  /** Pre-formatted value for the legend (e.g. "1.2 GB"). Falls back to the raw number. */
  display?: string;
};

/**
 * Stacked proportional bar + wrapping legend — a composition breakdown of one
 * total (storage by asset kind, trip time by activity). Segments are laid out
 * with flex on their share of the sum, so no width measurement is needed.
 *
 * A `total` larger than the segment sum leaves the remainder as empty track,
 * which is what "used vs. capacity" wants; omit it for a pure share-of-whole
 * bar. Segments thinner than 2% are floored to a visible sliver so a small
 * asset class never disappears from its own breakdown.
 */
export function CapacityBar({
  segments,
  total,
  legend = true,
}: {
  segments: CapacitySegment[];
  total?: number;
  legend?: boolean;
}) {
  const present = segments.filter((segment) => segment.value > 0);
  const sum = present.reduce((acc, segment) => acc + segment.value, 0);
  const basis = total != null && total > sum ? total : sum;
  const remainder = basis - sum;

  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        {present.map((segment) => (
          <View
            key={segment.label}
            style={{
              flexGrow: Math.max(segment.value / basis, 0.02),
              backgroundColor: segment.color,
            }}
          />
        ))}
        {remainder > 0 ? <View style={{ flexGrow: remainder / basis }} /> : null}
      </View>
      {legend && present.length > 0 ? (
        <View style={styles.legend}>
          {present.map((segment) => (
            <View key={segment.label} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: segment.color }]} />
              <Text style={styles.legendLabel}>{segment.label}</Text>
              <Text style={styles.legendValue}>{segment.display ?? String(segment.value)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing(1.25) },
  track: {
    flexDirection: "row",
    height: 6,
    borderRadius: radius.pill,
    overflow: "hidden",
    backgroundColor: withAlpha(theme.textPrimary, 0.1),
    gap: 2,
  },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1.5), rowGap: spacing(0.75) },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  legendLabel: { color: theme.textMuted, fontSize: fontSize.xs },
  legendValue: {
    color: theme.textPrimary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
});
