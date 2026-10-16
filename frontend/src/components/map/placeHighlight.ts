/**
 * The place whose pin is lit because its Places row is under the pointer.
 *
 * NOT React state. A hover changes many times a second; keeping it in React
 * state would re-render App, Map and every row in the list on each pointer
 * movement. The list writes here, the map subscribes and sets a layer filter,
 * avoiding React re-renders on hover.
 */
export type PlaceHighlight = {
  set: (id: string | null) => void;
  /** Calls the listener with the current id at once, then on every change. */
  subscribe: (listener: (id: string | null) => void) => () => void;
};

export function createPlaceHighlight(): PlaceHighlight {
  let current: string | null = null;
  const listeners = new Set<(id: string | null) => void>();
  return {
    set: (id) => {
      if (id === current) return;
      current = id;
      for (const listener of listeners) listener(id);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      listener(current);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
