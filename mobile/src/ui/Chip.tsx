import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, hitSlop, radius, spacing, surface, theme, withAlpha } from "../theme";

/**
 * The pill primitive behind every chip surface — filter rails
 * (`SegmentedControl`) and multi-select vocabularies (`ChipPicker`) both render
 * this, so a chip looks the same wherever it appears.
 *
 * Active fills with `hue` (default accent) and inverts its label; a `count`
 * rides as a trailing badge, an `icon` leads.
 */
export function Chip({
  label,
  active = false,
  disabled = false,
  hue,
  icon,
  count,
  onPress,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  hue?: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
  count?: number;
  onPress: () => void;
}) {
  const tint = hue ?? theme.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={hitSlop}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: tint, borderColor: tint },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon ? (
        <Feather name={icon} size={14} color={active ? theme.primary : tint} />
      ) : null}
      <Text style={[styles.label, active && styles.labelActive, disabled && styles.labelDisabled]}>
        {label}
      </Text>
      {count != null ? (
        <View style={[styles.badge, active && styles.badgeActive]}>
          <Text style={[styles.badgeText, active && styles.badgeTextActive]}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(0.75),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: surface.border,
    backgroundColor: surface.card,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
    minHeight: 36,
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  label: { color: theme.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  labelActive: { color: theme.primary },
  labelDisabled: { color: theme.textMuted },
  badge: {
    minWidth: 20,
    paddingHorizontal: spacing(0.5),
    borderRadius: radius.pill,
    backgroundColor: withAlpha(theme.textPrimary, 0.12),
    alignItems: "center",
  },
  badgeActive: { backgroundColor: withAlpha(theme.primary, 0.2) },
  badgeText: { color: theme.textMuted, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  badgeTextActive: { color: theme.primary },
});
