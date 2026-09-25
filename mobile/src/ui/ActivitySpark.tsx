import { StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";

export type ActivityBucket = {
  /** One- or two-character axis label (month initial, year digits). */
  label: string;
  count: number;
  /** Renders in the accent colour with a brighter label — "you are here". */
  current?: boolean;
};

/**
 * Tiny bar chart for "how much have I been getting out" — a retrospective
 * screen's hero can answer that in a glance where a count cannot.
 *
 * Deliberately NOT interactive: it carries no press affordance because it
 * exposes no filter. A chart that looks tappable and isn't is the same broken
 * promise as a drag handle that doesn't drag.
 *
 * Bars are proportional to the busiest bucket, with an empty bucket drawn as
 * just its track — a floor height would make "no trips" look like "one trip".
 */
export function ActivitySpark({
  buckets,
  caption,
}: {
  buckets: ActivityBucket[];
  caption?: string;
}) {
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {buckets.map((bucket, index) => (
          <View key={`${bucket.label}-${index}`} style={styles.column}>
            <View style={styles.track}>
              {bucket.count > 0 ? (
                <View
                  style={[
                    styles.fill,
                    {
                      height: `${(bucket.count / peak) * 100}%`,
                      backgroundColor: bucket.current
                        ? theme.accent
                        : withAlpha(theme.accent, 0.55),
                    },
                  ]}
                />
              ) : null}
            </View>
            <Text style={[styles.label, bucket.current && styles.labelCurrent]}>
              {bucket.label}
            </Text>
          </View>
        ))}
      </View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const BAR_HEIGHT = 28;

const styles = StyleSheet.create({
  wrap: { gap: spacing(0.5) },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: spacing(0.5) },
  column: { flex: 1, alignItems: "stretch", gap: spacing(0.25) },
  track: {
    height: BAR_HEIGHT,
    justifyContent: "flex-end",
    backgroundColor: withAlpha(theme.textPrimary, 0.08),
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  fill: { borderRadius: radius.sm },
  label: {
    textAlign: "center",
    color: theme.textMuted,
    fontSize: fontSize.xs,
  },
  labelCurrent: { color: theme.textPrimary, fontWeight: fontWeight.medium },
  caption: { color: theme.textMuted, fontSize: fontSize.xs },
});
