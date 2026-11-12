import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";

import { spacing } from "../theme";
import { IconButton } from "./IconButton";
import { Row } from "./Row";
import { Toggle } from "./Toggle";
import type { Glyph } from "./Icon";

/**
 * A setting: its title and an explanation on the left, the switch on the right.
 * The WHOLE row is the switch's target (UX §4: a thing that does something on
 * press looks pressable), so it sits on the card colour like any pressable row,
 * and a screen reader meets one `switch` named by the title. The `Toggle`
 * inside is the drawing; it takes no touches of its own. `help` is the one
 * press inside it that doesn't flip the switch: a button to a finger and, since
 * a screen reader meets the row as one switch, an action of that switch.
 *
 * `disabled` dims it and stops it answering; `description` then carries the
 * reason ("Needs an account"), which a screen reader hears as the hint.
 * Same props as Logjam Web's `SwitchRow`.
 */
export function SwitchRow({
  title,
  description,
  descriptionNumberOfLines,
  icon,
  hue,
  leading,
  badge,
  help,
  style,
  checked,
  onChange,
  disabled = false,
}: {
  title: string;
  description?: string;
  descriptionNumberOfLines?: number;
  /** Only for a switch over a THING (the app lock), never over a statement. */
  icon?: Glyph;
  hue?: string;
  /** A leading node in place of the tile (a legend dot). */
  leading?: React.ReactNode;
  /** Beside the switch: a count of what the switch shows. */
  badge?: React.ReactNode;
  /** A help button beside the switch, where the row's press doesn't reach. */
  help?: { label: string; onPress: () => void };
  style?: ComponentProps<typeof Row>["style"];
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Row
      icon={icon}
      hue={hue}
      leading={leading}
      style={style}
      title={title}
      subtitle={description}
      subtitleNumberOfLines={descriptionNumberOfLines}
      checked={checked}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      accessibilityActions={
        help ? [{ name: "help", label: help.label }] : undefined
      }
      onAccessibilityAction={help?.onPress}
      right={
        <View style={styles.trailing}>
          {badge}
          {help ? (
            <IconButton
              icon="help"
              accessibilityLabel={help.label}
              onPress={help.onPress}
            />
          ) : null}
          <View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
          >
            <Toggle
              checked={checked}
              onChange={onChange}
              disabled={disabled}
              accessibilityLabel={title}
            />
          </View>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
});
