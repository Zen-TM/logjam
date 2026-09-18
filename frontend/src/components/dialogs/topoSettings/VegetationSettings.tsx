import { Fragment } from "react";
import { SVTM_FORMATIONS, type VegetationSettings as VegetationSettingsValue } from "@logjam/shared";
import { ColourField, LiveNumberField, SectionHeader, Toggle } from "../../../ui";
import SettingsRow from "./SettingsRow";
import type { NumericFieldConstraints } from "../../../numberInput";
import styles from "./topoSettings.module.css";

interface Props {
  value: VegetationSettingsValue;
  onChange: (next: VegetationSettingsValue) => void;
}

const RATIO_CONSTRAINTS: NumericFieldConstraints = { min: 0, max: 1 };
const ALPHA_CONSTRAINTS: NumericFieldConstraints = { min: 0, max: 255, integer: true };
const WEIGHT_CONSTRAINTS: NumericFieldConstraints = { min: 0, max: 5 };

/**
 * How thick the scrub is, drawn from the LiDAR returns that hit it rather than
 * the ground. The one sentence at the top is what the numbers MEAN — not a
 * description of the controls, which say what they are themselves.
 */
export default function VegetationSettings({ value, onChange }: Props) {
  const patch = (delta: Partial<VegetationSettingsValue>) => onChange({ ...value, ...delta });

  const setWeight = (formation: string, weight: number) =>
    patch({ formationWeights: { ...value.formationWeights, [formation]: weight } });

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Scrub density is the share of LiDAR returns caught between 0.25 m and 2 m
        above the ground — the height a body pushes through.
      </p>

      <SettingsRow
        label="Min ratio"
        tooltip="The density at which the layer starts to show. Anything below this is left transparent."
      >
        <LiveNumberField
          label="Min ratio"
          hideLabel
          className={styles.numberCell}
          value={value.minRatio}
          constraints={RATIO_CONSTRAINTS}
          onCommit={(minRatio) => patch({ minRatio })}
        />
      </SettingsRow>

      <SettingsRow
        label="Max ratio"
        tooltip="The density that draws in the dense colour at full opacity. Must be above the min ratio."
      >
        <LiveNumberField
          label="Max ratio"
          hideLabel
          className={styles.numberCell}
          value={value.maxRatio}
          constraints={RATIO_CONSTRAINTS}
          onCommit={(maxRatio) => patch({ maxRatio })}
        />
      </SettingsRow>

      <SettingsRow
        label="Sparse colour"
        tooltip="The colour at the min ratio. Its alpha is ignored — the two opacities below set that."
      >
        <ColourField
          label="Sparse colour"
          hideLabel
          value={value.sparseColour}
          onChange={(sparseColour) => patch({ sparseColour })}
        />
      </SettingsRow>

      <SettingsRow
        label="Dense colour"
        tooltip="The colour at the max ratio. Its alpha is ignored — the two opacities below set that."
      >
        <ColourField
          label="Dense colour"
          hideLabel
          value={value.denseColour}
          onChange={(denseColour) => patch({ denseColour })}
        />
      </SettingsRow>

      <SettingsRow label="Opacity at min ratio" tooltip="How opaque the layer is where it starts to show, 0–255.">
        <LiveNumberField
          label="Opacity at min ratio"
          hideLabel
          className={styles.numberCell}
          value={value.alphaMin}
          constraints={ALPHA_CONSTRAINTS}
          onCommit={(alphaMin) => patch({ alphaMin })}
        />
      </SettingsRow>

      <SettingsRow label="Opacity at max ratio" tooltip="How opaque the layer is at its densest, 0–255.">
        <LiveNumberField
          label="Opacity at max ratio"
          hideLabel
          className={styles.numberCell}
          value={value.alphaMax}
          constraints={ALPHA_CONSTRAINTS}
          onCommit={(alphaMax) => patch({ alphaMax })}
        />
      </SettingsRow>

      <SettingsRow
        label="Weight by vegetation type"
        tooltip="Scales the density by how hard each SVTM formation is to push through — heath resists, rainforest does not. Off, every formation counts the same."
      >
        <Toggle
          label="Weight by vegetation type"
          checked={value.weightsEnabled}
          onChange={(weightsEnabled) => patch({ weightsEnabled })}
        />
      </SettingsRow>

      <div className={styles.dependent} data-disabled={value.weightsEnabled ? undefined : true}>
        <SectionHeader title="Resistance per formation" />
        {/* A table: one heading over the numbers, not the range repeated on
            twelve rows (DESIGN.md §9). */}
        <div className={styles.formationTable}>
          <span />
          <span className={styles.head}>0–5</span>
          {SVTM_FORMATIONS.map((formation) => (
            <Fragment key={formation}>
              <span className={styles.formationName}>{formation}</span>
              <LiveNumberField
                label={`${formation} resistance`}
                hideLabel
                className={styles.numberCell}
                value={value.formationWeights[formation] ?? 1.0}
                constraints={WEIGHT_CONSTRAINTS}
                disabled={!value.weightsEnabled}
                onCommit={(weight) => setWeight(formation, weight)}
              />
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
