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
  REGION_CHOICE,
  regionOffRefusal,
  type Region,
} from "@logjam/shared";

import { capabilityStatus, type AccountState } from "../auth/capabilities";

/** The step after the terms: for a new account, and only once there is a choice. */
export const showsRegionStep = (
  newAccount: boolean,
  regions: readonly Region[] = REGIONS,
): boolean => newAccount && offersRegionChoice(regions);

/**
 * Whether a choice goes to the account: no for a guest (ADR 0007), yes for a
 * linked account. Connectivity doesn't decide it: a send that fails offline
 * puts the choice back and the screen offers Retry.
 */
export function sendsRegionChoice(accountState: AccountState): boolean {
  const status = capabilityStatus("serverPrefs", accountState, true);
  return !(
    status.status === "unavailable" && status.reason === "needs-account"
  );
}

/** The step's Continue button: never `disabled`, it explains on press (shared/DESIGN.md §5). */
export const regionContinueProps = (
  submitting: boolean,
  onPress: () => void,
) => ({ label: REGION_CHOICE.continue, onPress, loading: submitting });

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
    const reason = keepOne ? regionOffRefusal(chosen, region.id) : null;
    return {
      id: region.id,
      title: region.name,
      checked: chosen.includes(region.id),
      disabled: reason !== null,
      ...(reason !== null && { reason }),
    };
  });
}
