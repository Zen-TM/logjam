import { Switch } from "@mui/material";
import type { TopoSettings } from "@logjam/shared";
import SettingsRow from "./SettingsRow";
import styles from "./topoSettings.module.css";

interface Props {
  value: TopoSettings;
  onChange: (next: TopoSettings) => void;
}

const LAYER_INFO: { key: keyof TopoSettings; label: string; description: string }[] = [
  { key: "hillshade",  label: "Hillshade",   description: "Shaded relief raster from the DTM. Adds depth cueing to terrain." },
  { key: "vegetation", label: "Vegetation",  description: "Scrub density raster from LiDAR pulse ratios. Requires LAZ/LAS input." },
  { key: "slope",      label: "Slope",       description: "Slope-angle bands coloured by steepness." },
  { key: "contours",   label: "Contours",    description: "Vector contour lines at the configured zoom-band intervals." },
  { key: "features",   label: "OSM features", description: "Tracks, waterways, peaks, etc. from OpenStreetMap via Overpass." },
];

export default function LayerToggles({ value, onChange }: Props) {
  const setEnabled = (key: keyof TopoSettings, enabled: boolean) => {
    onChange({
      ...value,
      [key]: { ...value[key], enabled },
    });
  };

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Disabled layers are not generated and won't appear in the finished job.
        Saves processing time and storage for layers you don't need.
      </p>

      {LAYER_INFO.map(({ key, label, description }) => {
        const layer = value[key] as { enabled: boolean };
        return (
          <SettingsRow key={key} label={label} tooltip={description}>
            <Switch
              size="small"
              checked={layer.enabled}
              onChange={(_, checked) => setEnabled(key, checked)}
            />
          </SettingsRow>
        );
      })}
    </div>
  );
}
