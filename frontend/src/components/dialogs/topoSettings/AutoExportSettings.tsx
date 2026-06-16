import { useMemo } from "react";
import { Switch } from "@mui/material";
import {
  producedLayers,
  type AutoExportSettings as AutoExportSettingsValue,
  type RasterTemplateSettings,
  type ExportSelection,
  type TopoLayerKey,
} from "@logjam/shared";
import SettingsRow from "./SettingsRow";
import styles from "./topoSettings.module.css";
import TopoExportControls from "../TopoExportControls";

interface Props {
  value: AutoExportSettingsValue;
  onChange: (next: AutoExportSettingsValue) => void;
  /** Live raster settings — drives which layers this job will produce, so the
   *  layer picker offers the same choices the export dialog would post-run. */
  rasterSettings: RasterTemplateSettings;
}

export default function AutoExportSettings({ value, onChange, rasterSettings }: Props) {
  // Memoised so TopoExportControls' reconcile effect only re-runs when the
  // produced-layer set or the selection actually changes, not every render.
  const availableLayers = useMemo(
    () => new Set<TopoLayerKey>(producedLayers(rasterSettings)),
    [rasterSettings],
  );
  const selection = useMemo<ExportSelection>(
    () => ({ format: value.format, bundling: value.bundling, layers: value.layers }),
    [value.format, value.bundling, value.layers],
  );

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        When enabled, an export is queued automatically as soon as this topo
        finishes generating — no need to come back and start it by hand. It
        appears in the Exports section of the LiDAR panel and downloads when
        ready, exactly like a manual export. Only layers this job will produce
        can be chosen.
      </p>

      <SettingsRow
        label="Auto-export on completion"
        tooltip="Off by default. When on, the export settings below are applied automatically the moment the topo finishes — within a few minutes of completion."
      >
        <Switch
          size="small"
          checked={value.enabled}
          onChange={(_, checked) => onChange({ ...value, enabled: checked })}
        />
      </SettingsRow>

      <div className={value.enabled ? "" : styles.disabled}>
        <TopoExportControls
          value={selection}
          onChange={(next) => onChange({ ...value, ...next })}
          availableLayers={availableLayers}
        />
      </div>
    </div>
  );
}
