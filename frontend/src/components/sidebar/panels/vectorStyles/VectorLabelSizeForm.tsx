import { Slider } from "@mui/material";
import { LABEL_SCALE_MIN, LABEL_SCALE_MAX } from "@logjam/shared";
import SettingsRow from "../../../dialogs/topoSettings/SettingsRow";
import styles from "../../../dialogs/topoSettings/topoSettings.module.css";

interface Props {
  value: number;
  onChange: (next: number) => void;
}

// Global label-size multiplier — applies to both contour and feature labels, so
// it lives above the Contours/Features tabs rather than inside either. Drives the
// live map and is snapshotted into exports alongside the rest of the vector style.
export default function VectorLabelSizeForm({ value, onChange }: Props) {
  return (
    <div className={styles.tabPanel}>
      <SettingsRow
        label="Label size"
        tooltip="Scales contour elevation and feature name label text across the map and exports. 1× = default."
        trailing={`${value.toFixed(1)}×`}
      >
        <span />
      </SettingsRow>
      <Slider
        color="secondary"
        min={LABEL_SCALE_MIN}
        max={LABEL_SCALE_MAX}
        step={0.1}
        marks={[{ value: 1 }]}
        value={value}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${v.toFixed(1)}×`}
        onChange={(_e, v) => {
          if (typeof v === "number") onChange(v);
        }}
      />
    </div>
  );
}
