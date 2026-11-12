import { Pressable, StyleSheet } from "react-native";

import {
  hitSlop,
  opacity,
  radius,
  wash,
  withAlpha,
  makeThemed,
  useTheme,
} from "../theme";
import { Icon, type Glyph } from "./Icon";
import { showDisabledReason, type Disablable } from "./disabledReason";

// An intent colour as a glyph on a wash of itself falls under 3:1 on
// Ghost Gum's paper, so a filled button draws its glyph in the text colour and
// the wash alone carries the intent, as on Logjam Web.
const useIntents = makeThemed(
  (theme) => new Set([theme.accent, theme.warning, theme.success]),
);

// Single-glyph tappable — row overflow menus, sheet dismiss, inline delete.
// 40pt square (56pt with `hitSlop`, over the 48pt target), with an
// optional tinted disc so a destructive or primary glyph doesn't float
// unanchored in a row. `accessibilityLabel` is required: a glyph alone is not
// a label to a screen reader.
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  color,
  disabled = false,
  disabledReason,
  reasonShown,
  filled = false,
  size = 20,
}: {
  icon: Glyph;
  onPress: () => void;
  accessibilityLabel: string;
  color?: string;
  filled?: boolean;
  size?: number;
} & Disablable) {
  const theme = useTheme();
  const INTENTS = useIntents();
  color ??= theme.textMuted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // Not `disabled` in the state: TalkBack may then refuse the double-tap
      // that asks why, so the hint says it is unavailable instead.
      accessibilityHint={
        disabled ? `Unavailable. ${disabledReason}` : undefined
      }
      // Stays pressable, and says why (shared/DESIGN.md §5).
      onPress={
        disabled
          ? () =>
              disabledReason &&
              !reasonShown &&
              showDisabledReason(disabledReason)
          : onPress
      }
      hitSlop={hitSlop}
      style={({ pressed }) => [
        styles.base,
        filled && { backgroundColor: withAlpha(color, wash.strong) },
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon
        idea={icon}
        size={size}
        color={
          disabled
            ? theme.textMuted
            : filled && INTENTS.has(color)
              ? theme.text
              : color
        }
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});
