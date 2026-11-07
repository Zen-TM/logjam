// What the region choice draws, as plain data: the first-login step
// (`ConsentGate`) and the Settings row and page (`SettingsScreen`,
// `settings/RegionsSettingsScreen`). Mobile's tests run without a renderer, so
// each decision the screens take lives here, where regionChoice.test.ts can
// check it with two fixture regions and with one.
import {
  chosenRegionsLabel,
  offersRegionChoice,
  REGIONS,
  regionChoiceProblem,
  type Region,
} from "@logjam/shared";

/** The step after the terms: for a new account, and only once there is a choice. */
export const showsRegionStep = (
  newAccount: boolean,
  regions: readonly Region[] = REGIONS,
): boolean => newAccount && offersRegionChoice(regions);

/** The Settings row that opens the regions page, or null with one region. */
export function regionsSettingsRow(
  ids: readonly string[],
  regions: readonly Region[] = REGIONS,
): { subtitle: string } | null {
  return offersRegionChoice(regions)
    ? { subtitle: chosenRegionsLabel(ids, regions) }
    : null;
}

/**
 * What pressing Continue does: send the choice, or say why not. The button is
 * never disabled for validation (shared/DESIGN.md §5).
 */
export const regionStepPress = (
  chosen: readonly string[],
): { send: true } | { explain: string } => {
  const problem = regionChoiceProblem(chosen);
  return problem === null ? { send: true } : { explain: problem };
};

export type RegionSwitch = {
  id: string;
  title: string;
  checked: boolean;
  disabled: boolean;
  /** Why it can't be turned off, for the row's description. */
  reason?: string;
};

/**
 * One switch per region. With `keepOne` (Settings) the last one on can't be
 * turned off; the step lets it go and holds Continue instead.
 */
export function regionSwitches(
  chosen: readonly string[],
  regions: readonly Region[] = REGIONS,
  keepOne = false,
): RegionSwitch[] {
  return regions.map((region) => {
    const checked = chosen.includes(region.id);
    const refused = keepOne && checked && chosen.length === 1;
    return {
      id: region.id,
      title: region.name,
      checked,
      disabled: refused,
      ...(refused && { reason: regionChoiceProblem([])! }),
    };
  });
}

/** The choice after one switch moves, in `regions`' order. */
export function toggledRegions(
  chosen: readonly string[],
  id: string,
  on: boolean,
  regions: readonly Region[] = REGIONS,
): string[] {
  return regions
    .map((region) => region.id)
    .filter((each) => (each === id ? on : chosen.includes(each)));
}
