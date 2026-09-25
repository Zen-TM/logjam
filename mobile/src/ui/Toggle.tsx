import { Switch } from "react-native";

import { theme } from "../theme";

// Themed on/off switch — the standard visibility/enable control across the
// layer sheet (overlays, imports, tracks, GeoPDFs) and settings. Wraps RN's
// native Switch so the accent track colour lives in one place.
export function Toggle({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ false: theme.bonus2, true: theme.accent }}
      thumbColor={theme.textPrimary}
      ios_backgroundColor={theme.bonus2}
    />
  );
}
