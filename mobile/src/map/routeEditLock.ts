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
