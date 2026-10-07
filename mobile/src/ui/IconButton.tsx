import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { hitSlop, radius, theme, withAlpha } from "../theme";

// An intent colour as a glyph on a wash of itself falls under 3:1 on
// Daylight's paper, so a filled button draws its glyph in the text colour and
// the wash alone carries the intent, as on Logjam Web.
const INTENTS = new Set([theme.accent, theme.warning, theme.success]);

// Single-glyph tappable — row overflow menus, sheet dismiss, inline delete.
// 40pt square (56pt with `hitSlop`, over the 48pt target), with an
// optional tinted disc so a destructive or primary glyph doesn't float
// unanchored in a row. `accessibilityLabel` is required: a glyph alone is not
// a label to a screen reader.
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  color = theme.textMuted,
  disabled = false,
  filled = false,
  size = 20,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  accessibilityLabel: string;
  color?: string;
  disabled?: boolean;
  filled?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      style={({ pressed }) => [
        styles.base,
        filled && { backgroundColor: withAlpha(color, 0.16) },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Feather
        name={icon}
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
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});
