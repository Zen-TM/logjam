import { Switch } from "react-native";

import { opacity, theme } from "../theme";

// Themed on/off switch — the standard visibility/enable control across the
// layer sheet (overlays, imports, tracks, GeoPDFs) and settings. Wraps RN's
// native Switch so the accent track colour lives in one place. Same prop
// names as Logjam Web's `Toggle`; a switch with a title of its own is a
// `SwitchRow`, which makes the whole row the target.
export function Toggle({
  checked,
  onChange,
  disabled = false,
  accessibilityLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Switch
      value={checked}
      onValueChange={onChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled }}
      style={disabled ? { opacity: opacity.disabled } : undefined}
      trackColor={{ false: theme.line, true: theme.accent }}
      thumbColor={theme.text}
      ios_backgroundColor={theme.line}
    />
  );
}
