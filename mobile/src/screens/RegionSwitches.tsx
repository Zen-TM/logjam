// One switch per region, shared by the first-login step and the Settings page.
import { REGIONS, toggleRegion, type Region } from "@logjam/shared";

import { SwitchRow } from "../ui";
import { regionSwitches } from "./regionChoice";

export function RegionSwitches({
  chosen,
  onChange,
  keepOne = false,
  disabled = false,
  regions = REGIONS,
}: {
  chosen: readonly string[];
  onChange: (next: string[]) => void;
  /** The last switch on can't be turned off (Settings). */
  keepOne?: boolean;
  disabled?: boolean;
  regions?: readonly Region[];
}) {
  return (
    <>
      {regionSwitches(chosen, regions, keepOne).map((region) => (
        <SwitchRow
          key={region.id}
          title={region.title}
          description={region.reason}
          checked={region.checked}
          disabled={disabled || region.disabled}
          onChange={() => onChange(toggleRegion(chosen, region.id, regions))}
        />
      ))}
    </>
  );
}
