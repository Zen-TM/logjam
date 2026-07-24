import { StyleSheet, Text, View } from "react-native";

import { fontSize, radius, spacing, theme } from "../theme";

// Small status chip. `accent` = filled (active/saved-for-offline), `outline` =
// neutral bordered (Shared / Online), `warning` = attention (Update / error).
// The palette has no dedicated success green, so "saved offline" reads as the
// filled accent — the strongest on-palette affirmative.
type PillTone = "accent" | "outline" | "warning";

export function StatusPill({
  label,
  tone = "outline",
}: {
  label: string;
  tone?: PillTone;
}) {
  return (
    <View style={[styles.base, styles[`${tone}Box`]]}>
      <Text style={[styles.label, styles[`${tone}Text`]]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.25),
    alignSelf: "flex-start",
  },
  label: { fontSize: fontSize.xs, fontWeight: "600" },
  accentBox: { backgroundColor: theme.accent },
  accentText: { color: theme.primary },
  outlineBox: { borderWidth: 1, borderColor: theme.bonus1 },
  outlineText: { color: theme.bonus1 },
  warningBox: { borderWidth: 1, borderColor: theme.warning },
  warningText: { color: theme.warning },
});
