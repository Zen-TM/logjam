import type { ChipOption } from "../../../ui";

export type SettingsTab = "hillshade" | "slope" | "vegetation" | "autoExport";

/** The layers a topo bakes, one tab each, then what happens when it is done.
 *  The rail itself belongs to the DIALOG — pinned under the title, so which
 *  group you are in never scrolls away from the settings it names. */
export const SETTINGS_TABS: ChipOption<SettingsTab>[] = [
  { value: "hillshade", label: "Hillshade" },
  { value: "slope", label: "Slope" },
  { value: "vegetation", label: "Vegetation" },
  { value: "autoExport", label: "Auto-export" },
];
