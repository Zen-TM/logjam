import { Switch } from "@mui/material";
import { SVTM_FORMATIONS, type VegetationSettings as VegetationSettingsValue } from "@logjam/shared";
import ColourPicker from "../../common/ColourPicker";
import SettingsRow from "./SettingsRow";
import styles from "./topoSettings.module.css";

interface Props {
  value: VegetationSettingsValue;
  onChange: (next: VegetationSettingsValue) => void;
}

export default function VegetationSettings({ value, onChange }: Props) {
  const patch = (delta: Partial<VegetationSettingsValue>) =>
    onChange({ ...value, ...delta });

  const setWeight = (formation: string, w: number) =>
    patch({ formationWeights: { ...value.formationWeights, [formation]: w } });

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Scrub density is a normalised pulse-ratio computed from LiDAR returns
        in the 0.25–2 m height band. Below <em>min ratio</em> = transparent;
        at/above <em>max ratio</em> = fully opaque dense colour. The colour
        ramps from sparse to dense along a sqrt curve.
      </p>

      <SettingsRow
        label="Min ratio"
        tooltip="LiDAR vegetation pulse ratio cutoff. Below this value the layer is transparent."
      >
        <input
          type="number"
          className={styles.numberInput}
          min={0}
          max={1}
          step={0.01}
          value={value.minRatio}
          onChange={(e) => patch({ minRatio: Number(e.target.value) })}
        />
      </SettingsRow>

      <SettingsRow
        label="Max ratio"
        tooltip="At or above this value the layer is fully opaque with the dense colour. Must be > min ratio."
      >
        <input
          type="number"
          className={styles.numberInput}
          min={0}
          max={1}
          step={0.01}
          value={value.maxRatio}
          onChange={(e) => patch({ maxRatio: Number(e.target.value) })}
        />
      </SettingsRow>

      <SettingsRow label="Sparse colour" tooltip="Colour at low density. Alpha here is ignored — use alpha min/max below.">
        <ColourPicker value={value.sparseColour} onChange={(c) => patch({ sparseColour: c })} />
      </SettingsRow>

      <SettingsRow label="Dense colour" tooltip="Colour at high density. Alpha here is ignored — use alpha min/max below.">
        <ColourPicker value={value.denseColour} onChange={(c) => patch({ denseColour: c })} />
      </SettingsRow>

      <SettingsRow label="Alpha at min ratio" tooltip="Layer opacity at the min-ratio cutoff (0..255).">
        <input
          type="number"
          className={styles.numberInput}
          min={0}
          max={255}
          step={1}
          value={value.alphaMin}
          onChange={(e) => patch({ alphaMin: Number(e.target.value) })}
        />
      </SettingsRow>

      <SettingsRow label="Alpha at max ratio" tooltip="Layer opacity at the max-ratio cutoff (0..255).">
        <input
          type="number"
          className={styles.numberInput}
          min={0}
          max={255}
          step={1}
          value={value.alphaMax}
          onChange={(e) => patch({ alphaMax: Number(e.target.value) })}
        />
      </SettingsRow>

      <SettingsRow
        label="SVTM formation weights"
        tooltip="When on, each SVTM vegetation formation scales the density by its resistance multiplier μ (hard heath vs. soft rainforest). Off ⇒ all μ = 1.0."
      >
        <Switch
          size="small"
          checked={value.weightsEnabled}
          onChange={(_, checked) => patch({ weightsEnabled: checked })}
        />
      </SettingsRow>

      <div className={value.weightsEnabled ? "" : styles.disabled}>
        <h4 className={styles.sectionTitle}>Per-formation μ (0–5)</h4>
        <div className={styles.formationGrid}>
          {SVTM_FORMATIONS.map((name) => (
            <FormationRow
              key={name}
              name={name}
              value={value.formationWeights[name] ?? 1.0}
              onChange={(w) => setWeight(name, w)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface FormationRowProps {
  name: string;
  value: number;
  onChange: (n: number) => void;
}

function FormationRow({ name, value, onChange }: FormationRowProps) {
  return (
    <>
      <span className={styles.formationName}>{name}</span>
      <input
        type="number"
        className={styles.numberInput}
        min={0}
        max={5}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </>
  );
}
