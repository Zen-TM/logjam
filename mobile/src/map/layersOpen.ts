import type { SectionKeysOn, MAP_LAYERS } from "@logjam/shared";

/** A tab of the sheet, as `MAP_LAYERS` names them for Logjam GPS. */
export type LayersTab = SectionKeysOn<typeof MAP_LAYERS, "gps">;

/**
 * Whether the sheet is open, held outside MapScreen. As MapScreen state, opening
 * or closing the sheet re-rendered the whole map tree (every layer's props
 * re-committed) in the same frames the sheet's window was being created.
 *
 * `tab` is the tab the opening asked for (the Weather bar's title opens it on
 * Weather); null when it asked for none, so the sheet keeps the tab it was on.
 */
export type LayersOpen = {
  get: () => boolean;
  tab: () => LayersTab | null;
  set: (open: boolean, tab?: LayersTab) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createLayersOpen(): LayersOpen {
  let open = false;
  let tab: LayersTab | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => open,
    tab: () => tab,
    set: (next, nextTab) => {
      const asked = next ? (nextTab ?? null) : null;
      if (next === open && asked === tab) return;
      open = next;
      tab = asked;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
