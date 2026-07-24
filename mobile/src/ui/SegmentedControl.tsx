import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontSize, radius, spacing, surface, theme } from "../theme";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

// Wrapping chip group for a single-select choice (basemap picker, filters).
// Wraps rather than scrolls so every option is visible at once; the active
// chip is accent-filled. Handles any option count.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.group}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: option.disabled }}
            disabled={option.disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              pressed && styles.chipPressed,
              option.disabled && styles.chipDisabled,
            ]}
          >
            <Text
              style={[
                styles.label,
                active && styles.labelActive,
                option.disabled && styles.labelDisabled,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: surface.border,
    backgroundColor: surface.card,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
    minHeight: 36,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipPressed: { opacity: 0.75 },
  chipDisabled: { opacity: 0.4 },
  label: { color: theme.textPrimary, fontSize: fontSize.sm, fontWeight: "600" },
  labelActive: { color: theme.primary },
  labelDisabled: { color: theme.textMuted },
});
