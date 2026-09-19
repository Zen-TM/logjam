/**
 * Where along a line the elevation cursor is, so the map can mark the same spot.
 *
 * NOT React state, for the reason `placeHighlight.ts` is not: a pointer dragged
 * across a chart emits many times a second, and as App state every one of those
 * re-rendered App, the map component and the panel — so the dot the user is
 * dragging waited behind a render of everything else, which is what an operator
 * reports as a laggy graph (2026-09-17, still laggy after the chart itself was
 * coalesced to one frame: the coalescing capped how OFTEN it happened, not how
 * much each one cost). The panel writes here, the map subscribes and sets a
 * GeoJSON source, and nothing renders.
 *
 * It carries the COLOUR as well as the position because the writer always knows
 * it — a route's own colour, or the draft's — and sending it along the same
 * channel keeps App from holding a `routeHoverColor` whose only job was to
 * follow the selection.
 */
export type RouteHover = {
  position: [number, number];
  /** The line's map colour, so the dot reads as part of it. */
  color: string | null;
} | null;

export type RouteHoverChannel = {
  set: (hover: RouteHover) => void;
  /** Calls the listener with the current value at once, then on every change. */
  subscribe: (listener: (hover: RouteHover) => void) => () => void;
};

const same = (a: RouteHover, b: RouteHover): boolean => {
  if (a === null || b === null) return a === b;
  return (
    a.position[0] === b.position[0] &&
    a.position[1] === b.position[1] &&
    a.color === b.color
  );
};

export function createRouteHoverChannel(): RouteHoverChannel {
  let current: RouteHover = null;
  const listeners = new Set<(hover: RouteHover) => void>();
  return {
    set: (hover) => {
      // A pointer that has not left the sample it was on costs nothing.
      if (same(hover, current)) return;
      current = hover;
      for (const listener of listeners) listener(hover);
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
