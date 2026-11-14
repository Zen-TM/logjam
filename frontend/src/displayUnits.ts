// Sets the units every formatter in shared/src/units.ts writes in, from the
// signed-in account's preferences (`unitsOf`). Logjam Web calls it while
// rendering its root, so each figure below reads the new units on the render
// that follows a choice in Settings; displayUnits.test.ts holds it.
import {
  REGIONS,
  setDisplayUnits,
  unitsOf,
  type Region,
  type Units,
} from "@logjam/shared";

export function applyDisplayUnits(
  uiPreferences: unknown,
  regions: readonly Region[] = REGIONS,
): Units {
  const units = unitsOf(uiPreferences, regions);
  setDisplayUnits(units);
  return units;
}
