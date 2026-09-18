import type { RasterTemplateSettings, AutoExportSettings as AutoExportSettingsValue } from "@logjam/shared";
import type { SettingsTab } from "./settingsTabs";
import HillshadeSettings from "./HillshadeSettings";
import SlopeSettings from "./SlopeSettings";
import VegetationSettings from "./VegetationSettings";
import AutoExportSettings from "./AutoExportSettings";

interface Props {
  tab: SettingsTab;
  value: RasterTemplateSettings;
  onChange: (next: RasterTemplateSettings) => void;
  autoExport: AutoExportSettingsValue;
  onAutoExportChange: (next: AutoExportSettingsValue) => void;
}

/** One group of settings — whichever the pinned rail is on. */
export default function AdvancedSettings({ tab, value, onChange, autoExport, onAutoExportChange }: Props) {
  const patch = <K extends keyof RasterTemplateSettings>(key: K, sub: RasterTemplateSettings[K]) =>
    onChange({ ...value, [key]: sub });

  switch (tab) {
    case "hillshade":
      return <HillshadeSettings value={value.hillshade} onChange={(v) => patch("hillshade", v)} />;
    case "slope":
      return <SlopeSettings value={value.slope} onChange={(v) => patch("slope", v)} />;
    case "vegetation":
      return <VegetationSettings value={value.vegetation} onChange={(v) => patch("vegetation", v)} />;
    case "autoExport":
      return <AutoExportSettings value={autoExport} onChange={onAutoExportChange} rasterSettings={value} />;
  }
}
