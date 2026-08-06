// Snap picker for the measure and route-draw HUDs.
//
// Segmented rather than a dropdown: four short options, and on a phone in the
// field a single tap beats opening a menu. It sits in the tool that it changes
// — it governs what the NEXT tap does, not a map layer.
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SnapMode } from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";

const OPTIONS: { mode: SnapMode; label: string }[] = [
  { mode: "off", label: "Off" },
  { mode: "trails", label: "Trails" },
  { mode: "waterways", label: "Creeks" },
  { mode: "both", label: "Both" },
];

export function SnapPicker({
  mode,
  onChange,
  unavailable,
  disabled,
}: {
  mode: SnapMode;
  onChange: (mode: SnapMode) => void;
  /** True when the basemap can't supply ways here (wrong basemap, or zoomed out). */
  unavailable: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>Snap</Text>
        {OPTIONS.map((option) => {
          const active = option.mode === mode;
          return (
            <Pressable
              key={option.mode}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={`Snap to ${option.label}`}
              disabled={disabled}
              onPress={() => onChange(option.mode)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {mode !== "off" && unavailable ? (
        <Text style={styles.note}>
          Needs the OSM Default (vector) basemap, zoomed in.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing(0.5) },
  row: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
  label: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginRight: spacing(0.25),
  },
  chip: {
    paddingHorizontal: spacing(0.75),
    paddingVertical: spacing(0.35),
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: withAlpha(theme.accent, 0.35),
  },
  chipActive: {
    backgroundColor: withAlpha(theme.accent, 0.25),
    borderColor: theme.accent,
  },
  chipText: { color: theme.textMuted, fontSize: fontSize.xs },
  chipTextActive: { color: theme.textPrimary, fontWeight: fontWeight.medium },
  note: { color: theme.warning, fontSize: fontSize.xs },
});
