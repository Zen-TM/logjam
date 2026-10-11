// Snap picker for the measure and route-draw HUDs.
//
// A wrapped ChipRail from the kit, not a hand-rolled chip row
// (DESIGN.md): four short options, all visible at once, and per §2 the
// wrapped form is right because this picks a SETTING rather than filtering a
// list below it.
//
// It lives in the tool it changes, not in the layers sheet, because it governs
// what the next tap does.
import type { SnapMode } from "@logjam/shared";

import { ChipRail, Field } from "../ui";

const OPTIONS: { value: SnapMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "trails", label: "Trails" },
  { value: "waterways", label: "Creeks" },
  { value: "both", label: "Both" },
];

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
    <Field label="Snap to">
      <ChipRail
        options={OPTIONS.map((option) => ({ ...option, disabled }))}
        value={mode}
        onChange={onChange}
      />
    </Field>
  );
}
