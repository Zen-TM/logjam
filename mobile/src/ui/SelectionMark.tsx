import { Feather } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { theme } from "../theme";

/**
 * The checkbox a row shows while a multi-select is running (DESIGN.md §7).
 *
 * It occupies EXACTLY an `IconButton`'s 40pt box, because it is what replaces
 * the row's ⋯ for the duration of the mode: a mark that sized itself would
 * change the row's height as the mode started, and the whole list jumps under
 * the finger that started it. Three screens had hand-rolled the same 40pt box
 * around the same 22pt glyph before this existed.
 *
 * `selectable: false` draws the empty box and no circle — a row a group verb
 * cannot act on is not pickable, and an unticked checkbox that refuses every
 * tap reads as a broken control rather than as an exclusion.
 */
export function SelectionMark({
  selected,
  selectable = true,
}: {
  selected: boolean;
  selectable?: boolean;
}) {
  return (
    <View style={styles.box}>
      {selectable ? (
        <Feather
          name={selected ? "check-circle" : "circle"}
          size={22}
          color={selected ? theme.accent : theme.textMuted}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
