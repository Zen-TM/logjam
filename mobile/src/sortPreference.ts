// A list's sort, kept per list on this device (shared/DESIGN.md §2): filters
// and search clear when the user leaves a list, the sort does not.
//
// Device-scoped in `prefsDb` like Logjam Web's `useStoredState`: a sort is a
// statement about how this person reads a list on this screen, not an account
// setting. A stored value that is no longer one of the list's sorts reads as
// the default.
import { useCallback, useState } from "react";

import { readPref, writePref } from "./prefsDb";

/** The stored sort for `list`, or `fallback`. Guard: `sortPreference.test.ts`. */
export function readSort<K extends string>(
  list: string,
  keys: readonly K[],
  fallback: K,
): K {
  const stored = readPref(`sort.${list}`);
  return keys.find((key) => key === stored) ?? fallback;
}

export function useStoredSort<K extends string>(
  list: string,
  keys: readonly K[],
  fallback: K,
): [K, (next: K) => void] {
  const [sort, setSortState] = useState(() => readSort(list, keys, fallback));
  const setSort = useCallback(
    (next: K) => {
      setSortState(next);
      writePref(`sort.${list}`, next);
    },
    [list],
  );
  return [sort, setSort];
}
