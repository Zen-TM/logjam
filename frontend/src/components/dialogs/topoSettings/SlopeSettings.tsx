import { Fragment, type CSSProperties } from "react";
import {
  DEFAULT_SLOPE_SCALE,
  MAP_TERRAIN,
  hasSlopeScaleEnd,
  insertSlopeBand,
  removeSlopeBand,
  rgbaCssFromHex,
  setSlopeScale,
  setSlopeThreshold,
  setSlopeUpper,
  slopeBandsError,
  slopeBoundaryRange,
  slopeScale,
  type SlopeBand,
  type SlopeSettings as SlopeSettingsValue,
} from "@logjam/shared";
import {
  Button,
  ColourField,
  IconButton,
  InfoTip,
  LiveNumberField,
  Icon,
  FieldError,
} from "../../../ui";
import type { NumericFieldConstraints } from "../../../numberInput";
import styles from "./topoSettings.module.css";

interface Props {
  value: SlopeSettingsValue;
  onChange: (next: SlopeSettingsValue) => void;
}

const ANGLE_TOOLTIP =
  "Degrees from flat. An easy walk is under 10°, a steep scramble around 30°, and a cliff 45° or " +
  "more. Each band starts where the one below it ends, so its neighbour follows what you set here.";

/**
 * Terrain coloured by steepness: a table of bands, its columns headed once
 * (DESIGN.md). Every editable number is a unique BOUNDARY owned by exactly
 * one box — the transparency threshold and each band's upper angle — so gaps
 * and overlaps are structurally impossible and a band's lower angle is simply
 * the one below it, shown rather than asked for.
 *
 * The colours are not picked per band: two ends of a scale are, and every band
 * is painted along it, so a band added or removed cannot leave a ramp with a
 * hole in it.
 */
export default function SlopeSettings({ value, onChange }: Props) {
  const bands = value.bands;

  // The ends round-trip losslessly through `bands`, so they are derived here
  // instead of held as parallel state that could drift from the persisted value.
  const { start: scaleStart, end: scaleEnd } = slopeScale(bands);

  const commitBands = (nextBands: SlopeBand[]) =>
    onChange({ ...value, bands: nextBands });

  const setScale = (start: string, end: string) =>
    commitBands(setSlopeScale(bands, start, end));

  const insertAt = (position: number) => {
    const nextBands = insertSlopeBand(bands, position);
    if (nextBands) commitBands(nextBands);
  };

  const error = slopeBandsError(bands);

  const insertControl = (position: number) => {
    const room = insertSlopeBand(bands, position) !== null;
    return (
      <button
        type="button"
        className={styles.insertRow}
        title={
          room ? "Add a band here" : "Eight bands is the most a topo can have"
        }
        aria-label={
          room ? "Add a band here" : "Eight bands is the most a topo can have"
        }
        disabled={!room}
        onClick={() => insertAt(position)}
      >
        <Icon idea="add" size={14} aria-hidden />
      </button>
    );
  };

  const boundaryConstraints = (
    boundary: "threshold" | number,
  ): NumericFieldConstraints => ({
    ...slopeBoundaryRange(bands, boundary),
    integer: true,
  });

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>{MAP_TERRAIN.copy.slopeBandsIntro}</p>

      <div className={styles.scaleRow}>
        <span className={styles.scaleEnd}>
          Start
          <ColourField
            label="Scale start colour (the shallowest band)"
            hideLabel
            value={scaleStart}
            onChange={(colour) => setScale(colour, scaleEnd)}
          />
        </span>
        {hasSlopeScaleEnd(bands) ? (
          <>
            <span className={styles.scaleArrow} aria-hidden>
              →
            </span>
            <span className={styles.scaleEnd}>
              End
              <ColourField
                label="Scale end colour (the steepest band)"
                hideLabel
                value={scaleEnd}
                onChange={(colour) => setScale(scaleStart, colour)}
              />
            </span>
          </>
        ) : null}
        <Button
          compact
          variant="outline"
          className={styles.scaleReset}
          onClick={() =>
            setScale(DEFAULT_SLOPE_SCALE.start, DEFAULT_SLOPE_SCALE.end)
          }
        >
          Reset colours
        </Button>
      </div>

      <div className={styles.bandTable}>
        {/* One glyph, on the angle that is actually edited: the lower one is
            the band below's upper, shown rather than asked for. */}
        <span className={styles.head}>From °</span>
        <span className={styles.head}>
          To °<InfoTip label="an angle" content={ANGLE_TOOLTIP} />
        </span>
        <span className={styles.head}>Colour</span>
        <span />

        {/* The transparency threshold is band[0].fromDeg: the only boundary
            whose band is not drawn at all. */}
        <span className={styles.fixedCell}>0</span>
        <LiveNumberField
          label="Transparency threshold in degrees"
          hideLabel
          className={styles.numberCell}
          value={bands[0].fromDeg}
          constraints={boundaryConstraints("threshold")}
          onCommit={(deg) => commitBands(setSlopeThreshold(bands, deg))}
        />
        <span className={styles.fixedCell}>Transparent</span>
        <span />

        {insertControl(0)}
        {bands.map((band, idx) => (
          <Fragment key={idx}>
            <span className={styles.fixedCell}>{band.fromDeg}</span>
            <LiveNumberField
              label={`Band ${idx + 1} upper angle in degrees`}
              hideLabel
              className={styles.numberCell}
              value={band.toDeg}
              constraints={boundaryConstraints(idx)}
              onCommit={(deg) => commitBands(setSlopeUpper(bands, idx, deg))}
            />
            <span
              className={styles.bandSwatch}
              role="img"
              aria-label={`Band ${idx + 1} colour, taken from the scale`}
            >
              <span
                className={styles.bandSwatchFill}
                style={
                  {
                    "--band-colour": rgbaCssFromHex(band.colour),
                  } as CSSProperties
                }
              />
            </span>
            {bands.length > 1 ? (
              <IconButton
                icon="delete"
                label={`Remove band ${idx + 1}`}
                onClick={() => commitBands(removeSlopeBand(bands, idx))}
              />
            ) : (
              <span />
            )}
            {insertControl(idx + 1)}
          </Fragment>
        ))}
      </div>

      <FieldError message={error} />
    </div>
  );
}
