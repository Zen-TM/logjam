import { useSyncExternalStore } from "react";

/**
 * "Show only these on the map" — the hand-off from the Canyons screen's filter
 * to the map's canyon layer, and the warning the map owes the user while it is
 * on.
 *
 * A module store rather than a context because the two screens live in
 * different tab stacks and the state has to survive the Canyons screen being
 * unmounted — switching to the map to look at the result is the whole point.
 *
 * The web forces this behaviour (its map always shows the filtered set). Here
 * it is opt-in, and the map carries a dismissible pill whenever canyons are
 * being withheld, because a map that silently hides pins is a map you can't
 * trust. Dismissing the pill turns the option off — the pill IS the way out.
 *
 * PRIVACY: canyon ids only, in memory, never persisted and never logged. No
 * region of interest is derived from this, and nothing here reaches the server.
 */
export type CanyonMapFilterState = {
  enabled: boolean;
  /**
   * The ids the Canyons screen last resolved, in no particular order. `null`
   * means the screen has never published (fresh launch), in which case the map
   * shows everything regardless of `enabled`.
   */
  visibleIds: string[] | null;
  /** Total canyons on the device, for the map's "N of M" pill. */
  totalCount: number;
};

const INITIAL: CanyonMapFilterState = {
  enabled: false,
  visibleIds: null,
  totalCount: 0,
};

let state: CanyonMapFilterState = INITIAL;
const listeners = new Set<() => void>();

function setState(next: CanyonMapFilterState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeCanyonMapFilter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCanyonMapFilter(): CanyonMapFilterState {
  return state;
}

export function useCanyonMapFilter(): CanyonMapFilterState {
  return useSyncExternalStore(subscribeCanyonMapFilter, getCanyonMapFilter);
}

export function setCanyonMapFilterEnabled(enabled: boolean): void {
  if (state.enabled === enabled) return;
  setState({ ...state, enabled });
}

/**
 * Publish the current filtered set. Called from a render effect, so it must be
 * a no-op when nothing changed: replacing the array every keystroke would
 * re-render the map (and, through `useSyncExternalStore`, loop).
 */
export function publishVisibleCanyons(ids: string[], totalCount: number): void {
  if (
    state.totalCount === totalCount &&
    state.visibleIds !== null &&
    sameIds(state.visibleIds, ids)
  ) {
    return;
  }
  setState({ ...state, visibleIds: ids, totalCount });
}

/** Order is stable (both come from the same sorted list), so index-wise is enough. */
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Whether the map is currently withholding canyons — the condition for its
 * warning pill. Filtering that happens to match everything is not withholding.
 */
export function isWithholdingCanyons(current: CanyonMapFilterState): boolean {
  return (
    current.enabled &&
    current.visibleIds !== null &&
    current.visibleIds.length < current.totalCount
  );
}

/** Test seam: drop all state between cases. */
export function resetCanyonMapFilterForTest(): void {
  setState(INITIAL);
}
