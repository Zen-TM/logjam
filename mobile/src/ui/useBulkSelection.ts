// Multi-select over a list of cards — the "press and hold one, tap to toggle,
// the rail becomes cancel / select-all / delete" interaction first shipped in
// SavedScreen, now shared by Canyons and Logs (and any other card list).
//
// The screen owns the DELETE (confirm copy + the actual mutation), because
// what a delete costs differs per kind — this hook owns only the selection:
// which keys are picked, what is pickable, and the toggle/clear/select-all
// verbs. Held as KEYS, not items: the list is rebuilt on every mirror/registry
// notification, and a key whose row has since been deleted simply stops
// matching, so a bulk delete can't count things that are gone.
import { useCallback, useMemo, useState } from "react";

export function useBulkSelection<Item>({
  items,
  keyOf,
  isDeletable,
}: {
  /** The list as it is currently shown (already filtered). */
  items: Item[];
  /** The item's stable key (its id, or `region:<id>` for registry rows). */
  keyOf: (item: Item) => string;
  /** False for a row a selection has nothing to do to (a shared canyon the
   *  user may not delete) — it is greyed out instead of pickable. */
  isDeletable: (item: Item) => boolean;
}) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const clearSelection = useCallback(() => setSelectedKeys([]), []);

  const toggleSelected = useCallback((key: string) => {
    setSelectedKeys((keys) =>
      keys.includes(key) ? keys.filter((other) => other !== key) : [...keys, key],
    );
  }, []);

  const selectItem = useCallback(
    (item: Item) => {
      if (!isDeletable(item)) return;
      toggleSelected(keyOf(item));
    },
    [isDeletable, keyOf, toggleSelected],
  );

  const selectedItems = useMemo(
    () => items.filter((item) => selectedKeys.includes(keyOf(item))),
    [items, keyOf, selectedKeys],
  );

  const selectableItems = useMemo(() => items.filter(isDeletable), [items, isDeletable]);

  const selectAll = useCallback(
    () => setSelectedKeys(selectableItems.map(keyOf)),
    [keyOf, selectableItems],
  );

  return {
    selectedKeys,
    clearSelection,
    toggleSelected,
    selectItem,
    selectAll,
    selectedItems,
    selectableItems,
    selecting: selectedItems.length > 0,
  };
}
