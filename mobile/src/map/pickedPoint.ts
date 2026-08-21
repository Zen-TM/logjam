// The coordinate the map picker handed back, waiting for the form that asked
// for it.
//
// ONE slot, not one per caller: only one picker can be on screen at a time, and
// `takePickedPoint` empties it, so a second form cannot read the first one's
// answer.
//
// A module store rather than a navigation param, for the same reason
// `lastCamera.ts` is one: react-navigation params are serialized into state
// that persists and gets logged by devtools, and this is a canyon's position —
// the most sensitive pair in the app (root CLAUDE.md). It is also simply
// simpler than routing a callback through a navigator, which react-navigation
// warns about for non-serializable params.
//
// TAKE, not read: the value is consumed exactly once, by the screen that
// regains focus after the picker leaves. Left in place it would re-apply itself
// the next time that screen was focused for any reason at all, silently
// rewriting a coordinate the user had since typed over.
//
// PRIVACY: in memory only, for the few hundred milliseconds between the
// picker's Confirm and the form's next focus. Never persisted, never logged.
export type PickedPoint = { latitude: number; longitude: number };

/**
 * A map tap carries fifteen meaningless decimals — the last ten of them
 * describe a patch of ground narrower than an atom. Trimmed HERE rather than in
 * each form, so every surface that receives a picked point receives it in the
 * same shape, and the number the user sees in the field is the number stored.
 */
const PICKED_COORD_DECIMALS = 6;

let pending: PickedPoint | null = null;

export function setPickedPoint(point: PickedPoint): void {
  pending = {
    latitude: Number(point.latitude.toFixed(PICKED_COORD_DECIMALS)),
    longitude: Number(point.longitude.toFixed(PICKED_COORD_DECIMALS)),
  };
}

/** The point, once. Null when the picker was cancelled or never opened. */
export function takePickedPoint(): PickedPoint | null {
  const point = pending;
  pending = null;
  return point;
}
