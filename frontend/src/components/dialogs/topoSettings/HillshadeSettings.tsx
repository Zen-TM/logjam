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
        tooltip="This setting replaces the sun position (azimuth and altitude) below."
      >
        <Toggle
          label="Multidirectional"
          checked={value.multidirectional}
          onChange={(multidirectional) => patch({ multidirectional })}
        />
      </SettingsRow>

      <SettingsRow label="Tint colour">
        <ColourField
          label="Hillshade tint colour"
          hideLabel
          value={value.colour}
          onChange={(colour) => patch({ colour })}
        />
      </SettingsRow>

      <SettingsRow
        label="Azimuth (°)"
        tooltip="Where the sun sits, in degrees, clockwise from north. 315° is what most maps use."
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
        tooltip="How high the sun sits above the horizontal."
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
        tooltip="Stretches the terrain's heights before it is shaded. Above 1 makes the country look steeper than it is, below 1 flattens it out."
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
