// The area the map picker handed back, waiting for the filter that asked for
// it. `pickedPoint.ts`'s twin, and deliberately its twin rather than a
// generalisation of it: one slot holding "a point OR a box" would let the
// waypoint form read an answer meant for the canyon filter, and the two have
// nothing in common but the hand-off shape.
//
// A module store rather than a navigation param, for the reason spelled out in
// `pickedPoint.ts`: react-navigation serializes params into state that persists
// and gets logged by devtools, and this box is a region of canyons — the same
// class of value as the coordinate that store exists to keep out of there.
//
// TAKE, not read: consumed exactly once, by the screen that regains focus when
// the picker leaves. Left in place it would re-apply itself the next time that
// screen was focused for any reason, silently restoring a filter the user had
// since cleared.
//
// PRIVACY: in memory only, for the moment between the picker's Confirm and the
// filter sheet's next focus. Never persisted, never logged, never sent.
import type { RegionBbox } from "@logjam/shared";

let pending: RegionBbox | null = null;
let start: RegionBbox | null = null;

/**
 * Where the picker should OPEN — the area the filter already holds, if any.
 *
 * A module store rather than a navigation param, and here the rule bites harder
 * than it does for a picked point: `CanyonPickPoint` carries its start
 * coordinate in params because that is a number the user typed and is looking
 * at, whereas this box is a region of canyons drawn on a map. Navigation state
 * persists and is dumped by devtools; a region of interest does not go in it.
 *
 * READ, not taken: the picker reads it while rendering, and honours it on its
 * first render only. Consuming it would empty the slot on a re-render and leave
 * the screen unable to say where it opened. It is overwritten by the next
 * request and cleared when the picker answers.
 */
export function setAreaPickerStart(area: RegionBbox | null): void {
  start = area;
}

export function readAreaPickerStart(): RegionBbox | null {
  return start;
}

export function setPickedArea(area: RegionBbox): void {
  pending = area;
  start = null;
}

/** The area, once. Null when the picker was cancelled or never opened. */
export function takePickedArea(): RegionBbox | null {
  const area = pending;
  pending = null;
  return area;
}
