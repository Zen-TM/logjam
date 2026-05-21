import { Switch } from "@mui/material";
import type { HillshadeSettings as HillshadeSettingsValue } from "@logjam/shared";
import ColourPicker from "../../common/ColourPicker";
import SettingsRow from "./SettingsRow";
import styles from "./topoSettings.module.css";

interface Props {
  value: HillshadeSettingsValue;
  onChange: (next: HillshadeSettingsValue) => void;
}

export default function HillshadeSettings({ value, onChange }: Props) {
  const patch = (delta: Partial<HillshadeSettingsValue>) =>
    onChange({ ...value, ...delta });

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Hillshade renders the shaded relief of the terrain. The tint colour is
        multiplied with the greyscale luminance and its alpha sets the overall
        opacity.
      </p>

      <SettingsRow label="Tint colour" tooltip="Greyscale luminance is multiplied by this colour. The alpha channel sets the layer opacity.">
        <ColourPicker value={value.colour} onChange={(c) => patch({ colour: c })} ariaLabel="Hillshade tint colour" />
      </SettingsRow>

      <SettingsRow
        label="Azimuth (°)"
        tooltip="Sun direction in degrees clockwise from north. 315° = NW, the standard cartographic light."
      >
        <input
          type="number"
          className={styles.numberInput}
          min={0}
          max={360}
          step={1}
          value={value.azimuth}
          onChange={(e) => patch({ azimuth: Number(e.target.value) })}
          disabled={value.multidirectional}
        />
      </SettingsRow>

      <SettingsRow
        label="Altitude (°)"
        tooltip="Sun elevation above the horizon. Lower values cast longer shadows."
      >
        <input
          type="number"
          className={styles.numberInput}
          min={0}
          max={90}
          step={1}
          value={value.altitude}
          onChange={(e) => patch({ altitude: Number(e.target.value) })}
          disabled={value.multidirectional}
        />
      </SettingsRow>

      <SettingsRow
        label="Vertical exaggeration"
        tooltip="Multiplies the terrain z-values before computing the hillshade. >1 amplifies relief; <1 flattens it."
      >
        <input
          type="number"
          className={styles.numberInput}
          min={0.1}
          max={10}
          step={0.1}
          value={value.zFactor}
          onChange={(e) => patch({ zFactor: Number(e.target.value) })}
        />
      </SettingsRow>

      <SettingsRow
        label="Multidirectional"
        tooltip="Blend hillshades from multiple sun angles for softer, less harsh shadows. Overrides azimuth/altitude when on."
      >
        <Switch
          size="small"
          checked={value.multidirectional}
          onChange={(_, checked) => patch({ multidirectional: checked })}
        />
      </SettingsRow>
    </div>
  );
}
