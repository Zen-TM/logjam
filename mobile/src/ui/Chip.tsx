import { Feather } from "@expo/vector-icons";
import { INK } from "@logjam/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, hitSlop, radius, spacing, surface, theme, withAlpha } from "../theme";

// The single source of a chip's height (padding + font + border collapse to
// this one number via `minHeight`) — `SegmentedControl` re-exports it so a
// scroll rail's height is never guessed at from outside this file.
export const CHIP_HEIGHT = 36;

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
  starred = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  hue?: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
  count?: number;
  /** Trailing star: this chip is the one that counts (ChipPicker's `primaryValue`). */
  starred?: boolean;
  onPress: () => void;
}) {
  const tint = hue ?? theme.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={starred ? `${label}, starred` : undefined}
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
        <Feather name={icon} size={14} color={active ? INK : tint} />
      ) : null}
      <Text style={[styles.label, active && styles.labelActive, disabled && styles.labelDisabled]}>
        {label}
      </Text>
      {starred ? (
        <Feather name="star" size={12} color={active ? INK : tint} />
      ) : null}
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
    minHeight: CHIP_HEIGHT,
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  label: { color: theme.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  // INK, not `primary`: on the shared heath fill `primary` is 3.7:1 (root
  // CLAUDE.md, "Text or a glyph ON a colour fill uses a dark ink").
  labelActive: { color: INK },
  labelDisabled: { color: theme.textMuted },
  badge: {
    minWidth: 20,
    paddingHorizontal: spacing(0.5),
    borderRadius: radius.pill,
    backgroundColor: withAlpha(theme.textPrimary, 0.12),
    alignItems: "center",
  },
  badgeActive: { backgroundColor: withAlpha(INK, 0.15) },
  badgeText: { color: theme.textMuted, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  badgeTextActive: { color: INK },
});
