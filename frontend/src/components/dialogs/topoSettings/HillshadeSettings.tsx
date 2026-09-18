import { HILLSHADE_LIMITS } from "@logjam/shared";
import type { HillshadeSettings as HillshadeSettingsValue } from "@logjam/shared";
import { ColourField, LiveNumberField, Toggle } from "../../../ui";
import SettingsRow from "./SettingsRow";
import type { NumericFieldConstraints } from "../../../numberInput";
import styles from "./topoSettings.module.css";

interface Props {
  value: HillshadeSettingsValue;
  onChange: (next: HillshadeSettingsValue) => void;
}

// Ranges come from the shared validator's HILLSHADE_LIMITS — never re-derive.
const AZIMUTH_CONSTRAINTS: NumericFieldConstraints = { ...HILLSHADE_LIMITS.azimuth };
const ALTITUDE_CONSTRAINTS: NumericFieldConstraints = { ...HILLSHADE_LIMITS.altitude };
const Z_FACTOR_CONSTRAINTS: NumericFieldConstraints = { ...HILLSHADE_LIMITS.zFactor };

/**
 * The shaded relief: where the sun is, and how hard the terrain is pushed at
 * it. Multidirectional comes FIRST because it takes the two angles over — a
 * switch that greys out the rows above it made the dependency read backwards.
 *
 * Every number applies as it is typed and is checked against the same limits
 * the Save button is gated on (`hillshadeSettingsError`), so an out-of-range
 * value is reported here and refused there rather than silently clamped.
 */
export default function HillshadeSettings({ value, onChange }: Props) {
  const patch = (delta: Partial<HillshadeSettingsValue>) => onChange({ ...value, ...delta });

  return (
    <div className={styles.tabPanel}>
      <SettingsRow
        label="Multidirectional"
        tooltip="Blends hillshades from several sun angles for softer, less harsh shadows. It takes over from the azimuth and altitude below."
      >
        <Toggle
          label="Multidirectional"
          checked={value.multidirectional}
          onChange={(multidirectional) => patch({ multidirectional })}
        />
      </SettingsRow>

      <SettingsRow
        label="Tint colour"
        tooltip="The greyscale relief is multiplied by this colour, and its alpha channel sets the layer's opacity."
      >
        <ColourField
          label="Hillshade tint colour"
          hideLabel
          value={value.colour}
          onChange={(colour) => patch({ colour })}
        />
      </SettingsRow>

      <SettingsRow
        label="Azimuth (°)"
        tooltip="Sun direction in degrees clockwise from north, 0–360. 315° is north-west, the standard cartographic light."
        disabled={value.multidirectional}
      >
        <LiveNumberField
          label="Azimuth (°)"
          hideLabel
          className={styles.numberCell}
          value={value.azimuth}
          constraints={AZIMUTH_CONSTRAINTS}
          disabled={value.multidirectional}
          onCommit={(azimuth) => patch({ azimuth })}
        />
      </SettingsRow>

      <SettingsRow
        label="Altitude (°)"
        tooltip="Sun elevation above the horizon, 0–90. Lower values cast longer shadows."
        disabled={value.multidirectional}
      >
        <LiveNumberField
          label="Altitude (°)"
          hideLabel
          className={styles.numberCell}
          value={value.altitude}
          constraints={ALTITUDE_CONSTRAINTS}
          disabled={value.multidirectional}
          onCommit={(altitude) => patch({ altitude })}
        />
      </SettingsRow>

      <SettingsRow
        label="Vertical exaggeration"
        tooltip="Multiplies the terrain's heights before the relief is computed, 0.1–10. Above 1 amplifies the relief; below 1 flattens it."
      >
        <LiveNumberField
          label="Vertical exaggeration"
          hideLabel
          className={styles.numberCell}
          value={value.zFactor}
          constraints={Z_FACTOR_CONSTRAINTS}
          onCommit={(zFactor) => patch({ zFactor })}
        />
      </SettingsRow>
    </div>
  );
}
