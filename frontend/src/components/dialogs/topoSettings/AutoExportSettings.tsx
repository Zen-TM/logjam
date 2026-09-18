import { useMemo } from "react";
import {
  producedLayers,
  type AutoExportSettings as AutoExportSettingsValue,
  type RasterTemplateSettings,
  type ExportSelection,
  type TopoLayerKey,
} from "@logjam/shared";
import { Toggle } from "../../../ui";
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

/**
 * An export queued the moment the topo finishes, instead of the user coming
 * back to start one. Off by default; the controls under the switch are the same
 * ones the export dialog uses, offering only the layers these settings will
 * actually produce.
 */
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
      <SettingsRow
        label="Export when it finishes"
        tooltip="Starts exporting the topo automatically once it finishes generating."
      >
        <Toggle
          label="Export when it finishes"
          checked={value.enabled}
          onChange={(enabled) => onChange({ ...value, enabled })}
        />
      </SettingsRow>

      <div className={styles.dependent} data-disabled={value.enabled ? undefined : true}>
        <TopoExportControls
          value={selection}
          onChange={(next) => onChange({ ...value, ...next })}
          availableLayers={availableLayers}
        />
      </div>
    </div>
  );
}
