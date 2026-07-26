import { StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, spacing, theme } from "../theme";
import { Chip } from "./Chip";
import { IconButton } from "./IconButton";
import { formatRange, isFullRange, nextRange, type NumberRange } from "./rangeSelect";

/**
 * A graded axis as a row of numbered pills — the mobile form of the web's
 * double-ended grade slider. Every stop is a 36pt tap target, the current
 * selection is readable without a tooltip, and it costs no gesture (a slider
 * inside a draggable sheet fights the sheet).
 *
 * Emits `null` for "any", which is exactly what the canyon filter treats as
 * inactive — so a cleared axis and an untouched one are the same value.
 */
export function RangePills({
  label,
  bounds,
  value,
  prefix = "",
  onChange,
}: {
  label: string;
  bounds: readonly [number, number];
  value: NumberRange | null;
  /** Rendered before each number in the summary ("V3–V5"), not on the pills. */
  prefix?: string;
  onChange: (next: NumberRange | null) => void;
}) {
  const [min, max] = bounds;
  const stops: number[] = [];
  for (let stop = min; stop <= max; stop += 1) stops.push(stop);
  const active = !isFullRange(value, bounds);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.valueGroup}>
          <Text style={[styles.value, active && styles.valueActive]}>
            {formatRange(value, bounds, prefix)}
          </Text>
          {active ? (
            <IconButton
              icon="x"
              size={14}
              accessibilityLabel={`Clear the ${label} filter`}
              onPress={() => onChange(null)}
            />
          ) : null}
        </View>
      </View>
      <View style={styles.pills}>
        {stops.map((stop) => (
          <Chip
            key={stop}
            label={String(stop)}
            active={value !== null && stop >= value[0] && stop <= value[1]}
            onPress={() => onChange(nextRange(value, stop))}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing(0.75) },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  valueGroup: { flexDirection: "row", alignItems: "center", gap: spacing(0.25) },
  value: { color: theme.textMuted, fontSize: fontSize.sm },
  valueActive: { color: theme.accent, fontWeight: fontWeight.medium },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: spacing(0.75) },
});
