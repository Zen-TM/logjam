import { Fragment } from "react";
import {
  RASTER_TEMPLATE_DEFAULTS,
  SVTM_FORMATIONS,
  type VegetationSettings as VegetationSettingsValue,
} from "@logjam/shared";
import {
  Button,
  ColourField,
  LiveNumberField,
  SectionHeader,
  SettingsRow,
  Toggle,
} from "../../../ui";
import type { NumericFieldConstraints } from "../../../numberInput";
import styles from "./topoSettings.module.css";

interface Props {
  value: VegetationSettingsValue;
  onChange: (next: VegetationSettingsValue) => void;
}

const RATIO_CONSTRAINTS: NumericFieldConstraints = { min: 0, max: 1 };
const WEIGHT_CONSTRAINTS: NumericFieldConstraints = { min: 0, max: 5 };

const DEFAULT_WEIGHTS = RASTER_TEMPLATE_DEFAULTS.vegetation.formationWeights;

// On the wire the layer's opacity is its own 0–255 number (`alphaMin` /
// `alphaMax`) and the colour's alpha byte is ignored — that is what the
// renderer reads, and it is not worth a settings migration to move. In the UI
// they are ONE control: the picker already has an opacity strip and a
// checkerboard behind the swatch, so a colour that says it is half transparent
// beside a number that says otherwise was two answers to one question.
const withAlpha = (colour: string, alpha: number) =>
  `${colour.slice(0, 7)}${Math.round(alpha).toString(16).padStart(2, "0")}`;
const alphaOf = (colour: string) => {
  const alpha = parseInt(colour.slice(7, 9), 16);
  return Number.isNaN(alpha) ? 255 : alpha;
};

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
        tooltip="Below this ratio, the vegetation layer is transparent."
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
        tooltip="Above this ratio, the vegetation layer uses the full-strength dense colour below."
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

      <SettingsRow label="Sparse colour" tooltip="The colour used where the scrub is thinnest.">
        <ColourField
          label="Sparse colour"
          hideLabel
          value={withAlpha(value.sparseColour, value.alphaMin)}
          onChange={(sparseColour) => patch({ sparseColour, alphaMin: alphaOf(sparseColour) })}
        />
      </SettingsRow>

      <SettingsRow label="Dense colour" tooltip="The colour used where the scrub is thickest.">
        <ColourField
          label="Dense colour"
          hideLabel
          value={withAlpha(value.denseColour, value.alphaMax)}
          onChange={(denseColour) => patch({ denseColour, alphaMax: alphaOf(denseColour) })}
        />
      </SettingsRow>

      <SettingsRow
        label="Weight by vegetation type"
        tooltip="Some vegetation is harder to push through than others. With this setting on, you can scale estimated density by vegetation formation."
      >
        <Toggle
          label="Weight by vegetation type"
          checked={value.weightsEnabled}
          onChange={(weightsEnabled) => patch({ weightsEnabled })}
        />
      </SettingsRow>

      <div className={styles.dependent} data-disabled={value.weightsEnabled ? undefined : true}>
        <div className={styles.resetLine}>
          <div>
            <SectionHeader title="Resistance per formation" />
            <p className={styles.helpText}>
              Use values above 1 for vegetation formations that are harder to
              push through, and values below 1 for formations that are easier.
            </p>
          </div>
          <Button
            compact
            variant="outline"
            className={styles.resetButton}
            disabled={!value.weightsEnabled}
            onClick={() => patch({ formationWeights: { ...DEFAULT_WEIGHTS } })}
          >
            Reset to defaults
          </Button>
        </div>
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
