import { useEffect, useState } from "react";
import { Switch } from "@mui/material";
import { HILLSHADE_LIMITS } from "@logjam/shared";
import type { HillshadeSettings as HillshadeSettingsValue } from "@logjam/shared";
import ColourPicker from "../../common/ColourPicker";
import SettingsRow from "./SettingsRow";
import ValidatedNumberField from "../ValidatedNumberField";
import { numericFieldError, type NumericFieldConstraints } from "../../../numberInput";
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
 * One numeric hillshade field (TOPO-2). Keeps a raw string so partial input
 * ("", "-", "45.") isn't mangled mid-keystroke; commits every parseable number
 * (even out of range) into settings so the inline error and the disabled
 * Save/Generate buttons (gated on the shared hillshadeSettingsError) both
 * point at the same value — no silent clamping or divergence. An unparseable
 * leftover snaps back to the last committed value on blur.
 */
function HillshadeNumberField({
  committed,
  onCommit,
  constraints,
  disabled,
}: {
  committed: number;
  onCommit: (v: number) => void;
  constraints: NumericFieldConstraints;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState(String(committed));

  // External changes (template switch, reset) resync the raw string. A raw
  // value that already means the committed number is left alone so typing
  // "45." isn't rewritten to "45" under the cursor.
  useEffect(() => {
    setRaw((prev) => (Number(prev) === committed && prev.trim() !== "" ? prev : String(committed)));
  }, [committed]);

  const isParseable = (s: string): boolean =>
    s.trim() !== "" && s.trim() !== "-" && Number.isFinite(Number(s));

  return (
    <div
      onBlur={() => {
        // Leftover unparseable input ("", "-") reverts to the committed
        // value; anything parseable was already committed on change.
        setRaw((prev) => (isParseable(prev) ? prev : String(committed)));
      }}
    >
      <ValidatedNumberField
        label=""
        value={raw}
        onChange={(next) => {
          setRaw(next);
          if (isParseable(next) && numericFieldError(next, { integer: constraints.integer }) === null) {
            onCommit(Number(next));
          }
        }}
        constraints={constraints}
        disabled={disabled}
        fullWidth={false}
        sx={{ width: 110 }}
      />
    </div>
  );
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
        tooltip="Sun direction in degrees clockwise from north, 0–360. 315° = NW, the standard cartographic light."
        disabled={value.multidirectional}
      >
        <HillshadeNumberField
          committed={value.azimuth}
          onCommit={(v) => patch({ azimuth: v })}
          constraints={AZIMUTH_CONSTRAINTS}
          disabled={value.multidirectional}
        />
      </SettingsRow>

      <SettingsRow
        label="Altitude (°)"
        tooltip="Sun elevation above the horizon, 0–90. Lower values cast longer shadows."
        disabled={value.multidirectional}
      >
        <HillshadeNumberField
          committed={value.altitude}
          onCommit={(v) => patch({ altitude: v })}
          constraints={ALTITUDE_CONSTRAINTS}
          disabled={value.multidirectional}
        />
      </SettingsRow>

      <SettingsRow
        label="Vertical exaggeration"
        tooltip="Multiplies the terrain z-values before computing the hillshade, 0.1–10. >1 amplifies relief; <1 flattens it."
      >
        <HillshadeNumberField
          committed={value.zFactor}
          onCommit={(v) => patch({ zFactor: v })}
          constraints={Z_FACTOR_CONSTRAINTS}
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
