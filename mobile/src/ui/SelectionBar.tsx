// The contextual bar a multi-select swaps into the rail's SegmentedControl slot.
// Cancel / count / select-all / destroy, fixed to SEGMENTED_CONTROL_HEIGHT so the
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
  deleteIcon = "trash-2",
  deleteLabel = "Delete the selected items",
}: {
  /** The words between the close and the buttons — "3 canyons selected". */
  countLabel: string;
  /** Hidden once everything selectable is picked (nothing left to add). */
  showSelectAll: boolean;
  /**
   * One more group verb, sitting between select-all and delete — an
   * `IconButton`, sized like the two it stands among. Two exist: the inbox's
   * read/unread toggle, and bulk share on Canyons and Saved. The bar stays a
   * fixed set of slots rather than an arbitrary toolbar: DESIGN.md §7 admits
   * only verbs that are BETTER in bulk than one at a time, and a bar that grows
   * a row per screen is how that rule stops being checkable.
   *
   * Sharing clears that bar and then some — picking 23 rows and sharing them in
   * one gesture is the whole point, and doing it one sheet at a time is what
   * the feature replaces. Logs deliberately has none: a trip log is not
   * shareable by any mechanism.
   */
  extra?: React.ReactNode;
  onClear: () => void;
  onSelectAll: () => void;
  /**
   * The bar's ONE destructive slot. Delete on every list of things the user
   * owns — hence the defaults — but the slot is the shape of the action, not
   * the word: the per-friend sharing screen puts "unshare these" and "remove my
   * access" here, which are destructive in the same way (irreversible from this
   * screen) and destructive of something else entirely (a grant, not a record).
   * Naming it delete there would have promised to destroy the canyon.
   */
  onDelete: () => void;
  /** Glyph for that slot. Feather; `trash-2` unless the verb is not deletion. */
  deleteIcon?: React.ComponentProps<typeof IconButton>["icon"];
  /** Screen-reader label for it — REQUIRED to change with the icon. */
  deleteLabel?: string;
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
        icon={deleteIcon}
        accessibilityLabel={deleteLabel}
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
