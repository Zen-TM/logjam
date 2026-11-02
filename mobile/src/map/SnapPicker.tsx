// Snap picker for the measure and route-draw HUDs.
//
// A ChipRail from the kit, not a hand-rolled chip row (DESIGN.md), in ONE
// scrolling line: the panel opens it from its "Snap" button rather than keeping
// a labelled two-row block on screen over the map.
//
// It lives in the tool it changes, not in the layers sheet, because it governs
// what the next tap does.
import { MAP_SNAP_OPTIONS, type SnapMode } from "@logjam/shared";

import { ChipRail } from "../ui";

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
    <ChipRail
      scroll
      options={MAP_SNAP_OPTIONS.map((option) => ({ ...option, disabled }))}
      value={mode}
      onChange={onChange}
    />
  );
}
