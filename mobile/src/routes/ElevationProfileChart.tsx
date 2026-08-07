// Elevation profile as a column chart.
//
// Columns of plain Views rather than a charting library or SVG: the app has
// neither, and the one existing chart in the kit (ui/ActivitySpark.tsx) is
// built exactly this way. A profile is a height per distance step, which is
// what a column chart already is — a line renderer would buy smoothness and
// cost a native dependency and a dev-client rebuild.
//
// Columns are scaled between the profile's own min and max, not from sea
// level: a canyon between 700 and 840 m drawn from zero is a flat bar.
import { StyleSheet, Text, View } from "react-native";
import { formatDistanceM, type ElevationProfile } from "@logjam/shared";

import { fontSize, radius, spacing, theme, withAlpha } from "../theme";

/** Columns drawn. More than this and each is sub-pixel on a phone. */
const MAX_COLUMNS = 48;
const CHART_HEIGHT = 76;
/** A column for the lowest point still needs to be visible as a column. */
const MIN_COLUMN_FRACTION = 0.06;

/** Even sampling down to at most MAX_COLUMNS, endpoints kept. */
function toColumns(samples: ElevationProfile["samples"]): (number | null)[] {
  if (samples.length <= MAX_COLUMNS) return samples.map((s) => s.elevationM);
  const step = (samples.length - 1) / (MAX_COLUMNS - 1);
  return Array.from(
    { length: MAX_COLUMNS },
    (_, i) => samples[Math.round(i * step)]!.elevationM,
  );
}

export function ElevationProfileChart({ profile }: { profile: ElevationProfile }) {
  const { minM, maxM } = profile;
  // No coverage anywhere means there is no chart to draw — the stats above it
  // already say the DEM had nothing here.
  if (minM == null || maxM == null || profile.samples.length < 2) return null;

  const columns = toColumns(profile.samples);
  const span = Math.max(1, maxM - minM);
  const totalM = profile.samples[profile.samples.length - 1]!.distanceM;

  return (
    <View style={styles.wrap}>
      <View style={styles.chart} accessibilityLabel="Elevation profile">
        {columns.map((elevation, index) => (
          <View key={index} style={styles.column}>
            {elevation == null ? null : (
              <View
                style={[
                  styles.bar,
                  {
                    height:
                      CHART_HEIGHT *
                      (MIN_COLUMN_FRACTION +
                        (1 - MIN_COLUMN_FRACTION) * ((elevation - minM) / span)),
                  },
                ]}
              />
            )}
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisLabel}>{Math.round(minM)} m</Text>
        <Text style={styles.axisLabel}>{formatDistanceM(totalM)}</Text>
        <Text style={styles.axisLabel}>{Math.round(maxM)} m</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing(0.5) },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: CHART_HEIGHT,
    gap: 1,
    backgroundColor: withAlpha(theme.textMuted, 0.08),
    borderRadius: radius.sm,
    paddingHorizontal: spacing(0.5),
    paddingVertical: spacing(0.25),
  },
  column: { flex: 1, justifyContent: "flex-end" },
  bar: {
    backgroundColor: theme.accent,
    borderTopLeftRadius: 1,
    borderTopRightRadius: 1,
  },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisLabel: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
});
