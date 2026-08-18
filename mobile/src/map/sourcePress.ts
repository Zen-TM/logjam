import type { NativeSyntheticEvent } from "react-native";

/**
 * A SOURCE'S PRESS BUBBLES TO THE MAP IN MLRN 11.
 *
 * MLRN 10 let a source's `onPress` consume the tap. MLRN 11 emits it on the
 * source AND on the `Map` (documented on `MapProps.onPress`), so tapping a
 * canyon pin, a route, a track or a waypoint ALSO ran the map's own handler —
 * which opens the "This point" sheet. Both panels appeared, and the point one
 * had to be dismissed to reach the one the user had actually asked for.
 *
 * It is worse than cosmetic while a point tool is armed: the map's handler
 * would place a point at the same tap that selected a feature.
 *
 * Every pressable source handler calls this FIRST, before any early return —
 * an `onPress` that bails without calling it still leaks the tap to the map.
 */
export function stopSourcePress(event: NativeSyntheticEvent<unknown>): void {
  event.stopPropagation();
}
