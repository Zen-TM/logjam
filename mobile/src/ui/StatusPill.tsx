import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, spacing, theme } from "../theme";

// Small status chip. `accent` = filled (active/saved-for-offline), `outline` =
// neutral bordered (Shared / Online), `warning` = attention (Update / error),
// `muted` = de-emphasised state that is not a problem (Queued / Paused).
// The palette has no dedicated success green, so "saved offline" reads as the
// filled accent — the strongest on-palette affirmative.
//
// Pills are fully rounded and never wider than their text; an optional `icon`
// carries state for glance-reading (check = ready, alert = needs attention).
type PillTone = "accent" | "outline" | "warning" | "muted";

export function StatusPill({
  label,
  tone = "outline",
  icon,
}: {
  label: string;
  tone?: PillTone;
  icon?: React.ComponentProps<typeof Feather>["name"];
}) {
  const color = TONE_TEXT[tone];
  return (
    <View style={[styles.base, styles[`${tone}Box`]]}>
      {icon ? <Feather name={icon} size={12} color={color} /> : null}
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const TONE_TEXT: Record<PillTone, string> = {
  accent: theme.primary,
  outline: theme.bonus1,
  warning: theme.warning,
  muted: theme.textMuted,
};

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(0.5),
    borderRadius: radius.pill,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.375),
    alignSelf: "flex-start",
  },
  label: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  accentBox: { backgroundColor: theme.accent },
  outlineBox: { borderWidth: 1, borderColor: theme.bonus1 },
  warningBox: { borderWidth: 1, borderColor: theme.warning },
  mutedBox: { borderWidth: 1, borderColor: theme.bonus2, backgroundColor: theme.bonus2 },
});
