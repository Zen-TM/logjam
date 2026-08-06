// Snap picker for the measure and route-draw HUDs.
//
// A wrapped SegmentedControl from the kit, not a hand-rolled chip row
// (DESIGN.md §9): four short options, all visible at once, and per §2 the
// wrapped form is right because this picks a SETTING rather than filtering a
// list below it.
//
// It lives in the tool it changes, not in the layers sheet, because it governs
// what the next tap does.
import { StyleSheet, Text, View } from "react-native";
import type { SnapMode } from "@logjam/shared";

import { fontSize, fontWeight, spacing, theme } from "../theme";
import { SegmentedControl } from "../ui";

const OPTIONS: { value: SnapMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "trails", label: "Trails" },
  { value: "waterways", label: "Creeks" },
  { value: "both", label: "Both" },
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
      <Text style={styles.label}>Snap to</Text>
      <SegmentedControl
        options={OPTIONS.map((option) => ({ ...option, disabled }))}
        value={mode}
        onChange={onChange}
      />
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
  label: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  note: { color: theme.warning, fontSize: fontSize.xs },
});
