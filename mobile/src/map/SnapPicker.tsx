// Snap picker for the measure and route-draw HUDs.
//
// A wrapped ChipRail from the kit, not a hand-rolled chip row
// (DESIGN.md §7): four short options, all visible at once, and per §2 the
// wrapped form is right because this picks a SETTING rather than filtering a
// list below it.
//
// It lives in the tool it changes, not in the layers sheet, because it governs
// what the next tap does.
import { StyleSheet, Text, View } from "react-native";
import type { SnapMode } from "@logjam/shared";

import { spacing } from "../theme";
import { ChipRail } from "../ui";
import { fieldLabel } from "../ui/fieldLabel";

const OPTIONS: { value: SnapMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "trails", label: "Trails" },
  { value: "waterways", label: "Creeks" },
  { value: "both", label: "Both" },
];

export function SnapPicker({
  mode,
  onChange,
  disabled,
}: {
  mode: SnapMode;
  onChange: (mode: SnapMode) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Snap to</Text>
      <ChipRail
        options={OPTIONS.map((option) => ({ ...option, disabled }))}
        value={mode}
        onChange={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing(0.5) },
  label: fieldLabel,
});
