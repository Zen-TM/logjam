import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { fontSize, radius, spacing, theme } from "../theme";

type ButtonVariant = "filledAccent" | "outlineAccent" | "ghost";

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
};

// Mirrors the web button system (filled accent / outline accent / ghost —
// MOBILE_DESIGN_BRIEF §7); other variants added as screens need them.
export function Button({
  label,
  onPress,
  variant = "filledAccent",
  disabled = false,
  loading = false,
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "filledAccent" ? theme.primary : theme.accent} />
      ) : (
        <Text style={[styles.label, variant === "filledAccent" ? styles.labelOnAccent : styles.labelAccent]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(2),
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  filledAccent: { backgroundColor: theme.accent },
  outlineAccent: { borderWidth: 1, borderColor: theme.accent },
  ghost: {},
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  label: { fontSize: fontSize.base, fontWeight: "600" },
  labelOnAccent: { color: theme.primary },
  labelAccent: { color: theme.accent },
});
