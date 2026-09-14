/**
 * The place whose pin is lit because its Places row is under the pointer.
 *
 * NOT React state. A hover changes many times a second, and as App state each
 * change re-rendered App, the map component and every row in the list: 56-300 ms
 * per row crossed with 37 places (measured 2026-09-14), and the row's own hover
 * styling waited behind that render. The list writes here, the map subscribes
 * and sets a layer filter, and nothing renders.
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
