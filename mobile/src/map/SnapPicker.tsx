// Snap picker for the measure and route-draw HUDs.
//
// A wrapped ChipRail from the kit, not a hand-rolled chip row
// (DESIGN.md): four short options, all visible at once, and per §2 the
// wrapped form is right because this picks a SETTING rather than filtering a
// list below it.
//
// It lives in the tool it changes, not in the layers sheet, because it governs
// what the next tap does.
import { MAP_MEASURE, MAP_SNAP_OPTIONS, type SnapMode } from "@logjam/shared";

import { ChipRail, Field } from "../ui";

export function SnapPicker({
  mode,
  onChange,
  disabled,
}: {
  mode: SnapMode;
  onChange: (mode: SnapMode) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={MAP_MEASURE.copy.snap}>
      <ChipRail
        options={MAP_SNAP_OPTIONS.map((option) => ({ ...option, disabled }))}
        value={mode}
        onChange={onChange}
      />
    </Field>
  );
}
