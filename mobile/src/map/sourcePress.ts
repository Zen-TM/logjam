import type { NativeSyntheticEvent } from "react-native";

/**
 * A source's press bubbles to the map in MLRN 11
 * (`docs/decisions/0015-mlrn-11-map-interaction-rules.md`).
 *
 * MLRN emits `onPress` on the source AND on the `Map` (documented on
 * `MapProps.onPress`), so tapping a place pin, a route, a track or a waypoint
 * also runs the map's own handler — which opens the "This point" sheet on top
 * of the selected feature.
 *
 * This is worse than cosmetic while a point tool is armed: the map's handler
 * places a point on the same tap that selected a feature.
 *
 * Every pressable source handler calls this FIRST, before any early return —
 * an `onPress` that bails without calling it still leaks the tap to the map.
 * Guard: mobile/src/map/sourcePress.test.ts.
 */
export function stopSourcePress(event: NativeSyntheticEvent<unknown>): void {
  event.stopPropagation();
}
