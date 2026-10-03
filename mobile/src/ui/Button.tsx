import { Feather } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import {
  controlSize,
  fontSize,
  fontWeight,
  radius,
  spacing,
  theme,
  touchTargetMin,
} from "../theme";

// A compact button is drawn at `controlSize.md`; the slop takes its target to
// the 48pt minimum.
const COMPACT_SLOP = (touchTargetMin - controlSize.md) / 2;

type ButtonVariant = "filledAccent" | "outlineAccent" | "ghost";

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading glyph, tinted with the label. */
  icon?: React.ComponentProps<typeof Feather>["name"];
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
      onPress={onPress}
      disabled={inactive}
      hitSlop={compact ? COMPACT_SLOP : undefined}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        grow && styles.grow,
        styles[variant],
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tint} />
      ) : (
        <>
          {icon ? (
            <Feather name={icon} size={compact ? 16 : 18} color={tint} />
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
  },
  compact: {
    paddingVertical: spacing(0.75),
    paddingHorizontal: spacing(1.5),
    minHeight: controlSize.md,
  },
  grow: { flex: 1 },
  filledAccent: { backgroundColor: theme.accent },
  outlineAccent: { borderWidth: 1, borderColor: theme.accent },
  ghost: {},
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  label: { fontSize: fontSize.base, fontWeight: fontWeight.medium },
  labelCompact: { fontSize: fontSize.sm },
});
