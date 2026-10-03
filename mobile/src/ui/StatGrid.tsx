import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, spacing, theme } from "../theme";
import { Icon } from "./Icon";

export type Stat = {
  label: string;
  value: string;
  /** Full-width cell instead of half. For a value that wraps badly at half
   *  width — a coordinate pair is the case this exists for. */
  span?: boolean;
  /** Makes the cell copy its value on tap, and draws a copy glyph beside the
   *  value so the tap can be found: a tile that only reveals it is a button
   *  when pressed is one nobody presses. */
  onCopy?: () => void;
};

// Two-column grid of labelled stats — the Place-detail Overview (Grade /
// Length / Abseils / Longest drop / Water / Rating): an uppercase eyebrow label
// above the value. Odd counts leave the last cell half-width, which reads fine.
//
// A cell is on the card colour only when it does something (`onCopy`): the
// fill means "press me" (UX §4). A read-only cell sits on the page with the
// same box, so a grid of both lines up.
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
                <Icon
                  idea="copy"
                  size={14}
                  color={theme.textMuted}
                  style={styles.copyGlyph}
                />
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
              stat.span && styles.span,
              pressed && styles.pressed,
            ]}
          >
            {content}
          </Pressable>
        ) : (
          <View
            key={stat.label}
            style={[styles.cell, styles.readOnly, stat.span && styles.span]}
          >
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
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: radius.md,
    padding: spacing(1.5),
    gap: spacing(0.25),
  },
  readOnly: { backgroundColor: "transparent", borderColor: "transparent" },
  span: { flexBasis: "100%" },
  pressed: { backgroundColor: theme.cardPressed },
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
    color: theme.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  // Pushed to the cell's right edge; the bottom nudge sits it on the value's
  // baseline rather than on the bottom of its line box.
  copyGlyph: { marginLeft: "auto", marginBottom: spacing(0.5) },
});
