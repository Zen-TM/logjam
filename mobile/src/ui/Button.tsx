import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import {
  controlSize,
  fontSize,
  fontWeight,
  opacity,
  radius,
  spacing,
  theme,
  touchTargetMin,
} from "../theme";
import { Icon, type Glyph } from "./Icon";

// A compact button is drawn at `controlSize.md`; the slop takes its target to
// the 48pt minimum.
const COMPACT_SLOP = (touchTargetMin - controlSize.md) / 2;

type ButtonVariant = "filledAccent" | "outlineAccent" | "ghost";

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /**
   * Why it is disabled (UX §5): "Needs a connection", "Needs an account".
   * Read by a screen reader as the hint, and what to show beside it. The button
   * does not draw it — the screen puts the words where there is room.
   */
  disabledReason?: string;
  loading?: boolean;
  /** Optional leading glyph, tinted with the label. */
  icon?: Glyph;
  /** Shrink-wrap for use inside a header/row instead of as a block action. */
  compact?: boolean;
  /**
   * Take an equal share of the row it sits in. Two grown buttons split the
   * width; the label is already centred, so they read as one control each
   * rather than as a pair of tags floating at the left edge.
   */
  grow?: boolean;
};

// Mirrors the web button system (filled accent / outline accent / ghost —
// MOBILE_DESIGN_BRIEF §7); other variants added as screens need them.
// Buttons are pill-shaped: the one rounded family shared with chips and pills.
export function Button({
  label,
  onPress,
  variant = "filledAccent",
  disabled = false,
  disabledReason,
  loading = false,
  icon,
  compact = false,
  grow = false,
}: ButtonProps) {
  const inactive = disabled || loading;
  // Words are never an intent colour: an outline button's label is the text
  // colour and its EDGE is the accent, as on Logjam Web.
  const tint = variant === "filledAccent" ? theme.onFill : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={disabled ? disabledReason : undefined}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      hitSlop={compact ? COMPACT_SLOP : undefined}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        grow && styles.grow,
        styles[variant],
        pressed && styles.pressed,
        // A button that is loading is working, not unavailable: it keeps its
        // colour, as on Logjam Web.
        disabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tint} />
      ) : (
        <>
          {icon ? (
            <Icon idea={icon} size={compact ? 16 : 18} color={tint} />
          ) : null}
          <Text
            style={[
              styles.label,
              compact && styles.labelCompact,
              { color: tint },
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(0.75),
    borderRadius: radius.pill,
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(2),
    minHeight: controlSize.lg,
    // A pill is never narrower than it is tall: a glyph-only button is a circle.
    minWidth: controlSize.lg,
  },
  compact: {
    paddingVertical: spacing(0.75),
    paddingHorizontal: spacing(1.5),
    minHeight: controlSize.md,
    minWidth: controlSize.md,
  },
  grow: { flex: 1 },
  filledAccent: { backgroundColor: theme.accent },
  outlineAccent: { borderWidth: 1, borderColor: theme.accent },
  ghost: {},
  pressed: { opacity: 0.75 },
  disabled: { opacity: opacity.disabled },
  label: { fontSize: fontSize.base, fontWeight: fontWeight.medium },
  labelCompact: { fontSize: fontSize.sm },
});
