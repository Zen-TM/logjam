import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, spacing, surface, theme } from "../theme";

export type Stat = {
  label: string;
  value: string;
  /** Full-width cell instead of half. For a value that wraps badly at half
   *  width — a coordinate pair is the case this exists for. */
  wide?: boolean;
  /** Makes the cell a button. Used for copy-to-clipboard on a coordinate. */
  onPress?: () => void;
};

// Two-column grid of labelled stat cards — the Canyon-detail Overview
// (Grade / Length / Abseils / Longest drop / Water / Rating). Each cell is a
// warm card with an uppercase eyebrow label above the value. Odd counts leave
// the last cell half-width, which reads fine.
export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.grid}>
      {stats.map((stat) => {
        const content = (
          <>
            <Text style={styles.label}>{stat.label}</Text>
            <Text style={styles.value}>{stat.value}</Text>
          </>
        );
        return stat.onPress ? (
          <Pressable
            key={stat.label}
            accessibilityRole="button"
            accessibilityLabel={`${stat.label}: ${stat.value}`}
            onPress={stat.onPress}
            style={({ pressed }) => [
              styles.cell,
              stat.wide && styles.wide,
              pressed && styles.pressed,
            ]}
          >
            {content}
          </Pressable>
        ) : (
          <View key={stat.label} style={[styles.cell, stat.wide && styles.wide]}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  cell: {
    flexGrow: 1,
    flexBasis: "47%",
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: surface.border,
    borderRadius: radius.md,
    padding: spacing(1.5),
    gap: spacing(0.25),
  },
  wide: { flexBasis: "100%" },
  pressed: { backgroundColor: surface.cardPressed },
  label: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  value: { color: theme.textPrimary, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
});
