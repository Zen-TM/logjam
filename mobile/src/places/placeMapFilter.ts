import { useSyncExternalStore } from "react";

/**
 * "Show only these on the map" — the hand-off from the Places screen's filter
 * to the map's place layer, and the warning the map owes the user while it is
 * on.
 *
 * A module store rather than a context because the two screens live in
 * different tab stacks and the state has to survive the Places screen being
 * unmounted — switching to the map to look at the result is the whole point.
 *
 * The web forces this behaviour (its map always shows the filtered set). Here
 * it is opt-in, and the map carries a dismissible pill whenever places are
 * being withheld, because a map that silently hides pins is a map you can't
 * trust. Dismissing the pill turns the option off — the pill IS the way out.
 *
 * PRIVACY: place ids only, in memory, never persisted and never logged. No
 * region of interest is derived from this, and nothing here reaches the server.
 */
export type PlaceMapFilterState = {
  enabled: boolean;
  /**
   * The ids the Places screen last resolved, in no particular order. `null`
   * means the screen has never published (fresh launch), in which case the map
   * shows everything regardless of `enabled`.
   */
  visibleIds: string[] | null;
  /** Total places on the device, for the map's "N of M" pill. */
  totalCount: number;
};

const INITIAL: PlaceMapFilterState = {
  enabled: false,
  visibleIds: null,
  totalCount: 0,
};

let state: PlaceMapFilterState = INITIAL;
const listeners = new Set<() => void>();

function setState(next: PlaceMapFilterState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribePlaceMapFilter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPlaceMapFilter(): PlaceMapFilterState {
  return state;
}

export function usePlaceMapFilter(): PlaceMapFilterState {
  return useSyncExternalStore(subscribePlaceMapFilter, getPlaceMapFilter);
}

export function setPlaceMapFilterEnabled(enabled: boolean): void {
  if (state.enabled === enabled) return;
  setState({ ...state, enabled });
}

/**
 * Publish the current filtered set. Called from a render effect, so it must be
 * a no-op when nothing changed: replacing the array every keystroke would
 * re-render the map (and, through `useSyncExternalStore`, loop).
 */
export function publishVisiblePlaces(ids: string[], totalCount: number): void {
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
 * Whether the map is currently withholding places — the condition for its
 * warning pill. Filtering that happens to match everything is not withholding.
 */
export function isWithholdingPlaces(current: PlaceMapFilterState): boolean {
  return (
    current.enabled &&
    current.visibleIds !== null &&
    current.visibleIds.length < current.totalCount
  );
}

/** Test seam: drop all state between cases. */
export function resetPlaceMapFilterForTest(): void {
  setState(INITIAL);
}
