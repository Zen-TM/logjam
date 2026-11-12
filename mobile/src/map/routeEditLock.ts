// "There is an unsaved route on the map right now."
//
// Module state rather than context because the two parties are far apart and
// only one bit travels between them: MapScreen knows when a draft is open, and
// the TAB NAVIGATOR in AppShell is what has to refuse the navigation. A context
// would mean wrapping the whole shell to move a boolean.
//
// The rule it enforces: leaving the map mid-draw would strand work with no
// visible home — the draft survives (routeDraftStore persists it), but the user
// has no way to see that, so it reads as losing the route. Finish or discard.
let editing = false;

export function setRouteEditing(value: boolean): void {
  editing = value;
}

export function isRouteEditing(): boolean {
  return editing;
}

/** Said in one place because it is said from two: the tab bar and a tapped
 *  notification are both ways off the map. */
export const FINISH_ROUTE_FIRST =
  "Finish your route first. Save it, or delete the draft, before leaving the map.";

const blockedListeners = new Set<() => void>();

/** Subscribe to "you tried to leave the map mid-draw": BackgroundToast, the
 *  only consumer, so a caller outside any component can answer the user. */
export function onRouteLeaveBlocked(listener: () => void): () => void {
  blockedListeners.add(listener);
  return () => blockedListeners.delete(listener);
}

export function announceRouteLeaveBlocked(): void {
  for (const listener of blockedListeners) listener();
}
