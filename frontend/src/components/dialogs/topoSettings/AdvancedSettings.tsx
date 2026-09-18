import { useState } from "react";
import type { RasterTemplateSettings, AutoExportSettings as AutoExportSettingsValue } from "@logjam/shared";
import { ChipRail, type ChipOption } from "../../../ui";
import HillshadeSettings from "./HillshadeSettings";
import SlopeSettings from "./SlopeSettings";
import VegetationSettings from "./VegetationSettings";
import AutoExportSettings from "./AutoExportSettings";

interface Props {
  value: RasterTemplateSettings;
  onChange: (next: RasterTemplateSettings) => void;
  autoExport: AutoExportSettingsValue;
  onAutoExportChange: (next: AutoExportSettingsValue) => void;
}

type SettingsTab = "hillshade" | "slope" | "vegetation" | "autoExport";

/** The layers a topo bakes, one tab each, then what happens when it is done. */
const TABS: ChipOption<SettingsTab>[] = [
  { value: "hillshade", label: "Hillshade" },
  { value: "slope", label: "Slope" },
  { value: "vegetation", label: "Vegetation" },
  { value: "autoExport", label: "When it's done" },
];

/**
 * How this topo's rasters are drawn. One `ChipRail` over the four groups — the
 * kit's single-choice control wherever the choice sits, including inside a
 * dialog, rather than a second look for the same decision (DESIGN.md §9).
 */
export default function AdvancedSettings({ value, onChange, autoExport, onAutoExportChange }: Props) {
  const [tab, setTab] = useState<SettingsTab>("hillshade");

  const patch = <K extends keyof RasterTemplateSettings>(key: K, sub: RasterTemplateSettings[K]) =>
    onChange({ ...value, [key]: sub });

  return (
    <div>
      <ChipRail label="Settings group" options={TABS} value={tab} onChange={setTab} />

      {tab === "hillshade" && (
        <HillshadeSettings value={value.hillshade} onChange={(v) => patch("hillshade", v)} />
      )}
      {tab === "slope" && <SlopeSettings value={value.slope} onChange={(v) => patch("slope", v)} />}
      {tab === "vegetation" && (
        <VegetationSettings value={value.vegetation} onChange={(v) => patch("vegetation", v)} />
      )}
      {tab === "autoExport" && (
        <AutoExportSettings value={autoExport} onChange={onAutoExportChange} rasterSettings={value} />
      )}
    </div>
  );
}
