/**
 * Whether the sheet is open, held outside MapScreen. As MapScreen state, opening
 * or closing the sheet re-rendered the whole map tree (every layer's props
 * re-committed) in the same frames the sheet's window was being created.
 */
export type LayersOpen = {
  get: () => boolean;
  set: (open: boolean) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createLayersOpen(): LayersOpen {
  let open = false;
  const listeners = new Set<() => void>();
  return {
    get: () => open,
    set: (next) => {
      if (next === open) return;
      open = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
