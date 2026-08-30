// The contextual bar a multi-select swaps into the rail's SegmentedControl slot.
// Cancel / count / select-all / delete, fixed to SEGMENTED_CONTROL_HEIGHT so the
// rail's height cannot differ between the two states and the list below does not
// jump (the bug the Saved screen fixed in 2026-08-24 — see its selectionBar note).
import { StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, spacing, theme } from "../theme";
import { IconButton } from "./IconButton";
import { SEGMENTED_CONTROL_HEIGHT } from "./SegmentedControl";

export function SelectionBar({
  countLabel,
  showSelectAll,
  extra,
  onClear,
  onSelectAll,
  onDelete,
}: {
  /** The words between the close and the buttons — "3 canyons selected". */
  countLabel: string;
  /** Hidden once everything selectable is picked (nothing left to add). */
  showSelectAll: boolean;
  /**
   * One more group verb, sitting between select-all and delete — an
   * `IconButton`, sized like the two it stands among. The inbox's read/unread
   * toggle is the only one so far, and the bar stays a fixed set of slots
   * rather than an arbitrary toolbar: DESIGN.md §7 admits only verbs that are
   * BETTER in bulk than one at a time, and a bar that grows a row per screen is
   * how that rule stops being checkable.
   */
  extra?: React.ReactNode;
  onClear: () => void;
  onSelectAll: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.bar}>
      <IconButton icon="x" accessibilityLabel="Clear selection" onPress={onClear} />
      <Text style={styles.count} numberOfLines={1}>
        {countLabel}
      </Text>
      {showSelectAll ? (
        <IconButton
          icon="check-square"
          accessibilityLabel="Select everything in this list"
          onPress={onSelectAll}
        />
      ) : null}
      {extra}
      <IconButton
        icon="trash-2"
        accessibilityLabel="Delete the selected items"
        color={theme.warning}
        filled
        onPress={onDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: SEGMENTED_CONTROL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(0.5),
    paddingLeft: spacing(0.5),
    paddingRight: spacing(1.5),
  },
  count: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});
