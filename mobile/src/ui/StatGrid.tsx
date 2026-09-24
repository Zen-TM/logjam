import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, spacing, surface, theme } from "../theme";

export type Stat = {
  label: string;
  value: string;
  /** Full-width cell instead of half. For a value that wraps badly at half
   *  width — a coordinate pair is the case this exists for. */
  wide?: boolean;
  /** Makes the cell copy its value on tap, and draws a copy glyph beside the
   *  value so the tap can be found: a tile that only reveals it is a button
   *  when pressed is one nobody presses. */
  onCopy?: () => void;
};

// Two-column grid of labelled stat cards — the Place-detail Overview
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
            {/* The glyph shares the value's row rather than being pinned to
                the corner, so a long value wraps before it instead of running
                underneath it. */}
            <View style={styles.valueRow}>
              <Text style={styles.value}>{stat.value}</Text>
              {stat.onCopy ? (
                <Feather name="copy" size={14} color={theme.textMuted} style={styles.copyGlyph} />
              ) : null}
            </View>
          </>
        );
        return stat.onCopy ? (
          <Pressable
            key={stat.label}
            accessibilityRole="button"
            accessibilityLabel={`${stat.label}: ${stat.value}`}
            accessibilityHint="Copies it to the clipboard"
            onPress={stat.onCopy}
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
  valueRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing(1) },
  value: {
    flexShrink: 1,
    color: theme.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  // Pushed to the cell's right edge; the bottom nudge sits it on the value's
  // baseline rather than on the bottom of its line box.
  copyGlyph: { marginLeft: "auto", marginBottom: spacing(0.5) },
});
