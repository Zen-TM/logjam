// What the units row of Settings → Display draws, as plain data, so
// unitsChoice.test.ts can check it without a renderer: the row, or null while
// every region is metric.
import {
  offersUnitsChoice,
  REGIONS,
  UNITS_CHOICE,
  type Region,
} from "@logjam/shared";

export function unitsSettingRow(
  regions: readonly Region[] = REGIONS,
): typeof UNITS_CHOICE | null {
  return offersUnitsChoice(regions) ? UNITS_CHOICE : null;
}
