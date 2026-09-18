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
        An estimate of bushbashing difficulty, derived from the proportion of
        LiDAR returns between 0.25 m and 2 m above the ground.
      </p>

      <SettingsRow
        label="Min ratio"
        tooltip="Below this, nothing is drawn and the ground shows through."
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
        tooltip="At this and above, the scrub is drawn at full strength in the dense colour. Has to be higher than the min ratio."
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
        tooltip="The colour used where the scrub is thinnest. Its own transparency is ignored — the two opacity settings below decide that."
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
        tooltip="The colour used where the scrub is thickest. Its own transparency is ignored — the two opacity settings below decide that."
      >
        <ColourField
          label="Dense colour"
          hideLabel
          value={value.denseColour}
          onChange={(denseColour) => patch({ denseColour })}
        />
      </SettingsRow>

      <SettingsRow label="Opacity at min ratio" tooltip="How solid the layer looks where the scrub only just starts to show. 0 is invisible, 255 is fully solid.">
        <LiveNumberField
          label="Opacity at min ratio"
          hideLabel
          className={styles.numberCell}
          value={value.alphaMin}
          constraints={ALPHA_CONSTRAINTS}
          onCommit={(alphaMin) => patch({ alphaMin })}
        />
      </SettingsRow>

      <SettingsRow label="Opacity at max ratio" tooltip="How solid the layer looks where the scrub is thickest. 0 is invisible, 255 is fully solid.">
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
        tooltip="Some vegetation is harder to get through than others. With this on, each SVTM formation scales the estimate by its own resistance — heath fights back, rainforest floor does not. Off, they all count the same."
      >
        <Toggle
          label="Weight by vegetation type"
          checked={value.weightsEnabled}
          onChange={(weightsEnabled) => patch({ weightsEnabled })}
        />
      </SettingsRow>

      <div className={styles.dependent} data-disabled={value.weightsEnabled ? undefined : true}>
        <SectionHeader title="Resistance per formation" />
        <p className={styles.helpText}>
          1 leaves a formation as measured. Above 1 counts it as harder to push
          through than the returns suggest, below 1 as easier.
        </p>
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
