import { Fragment, type CSSProperties } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  applySlopeGradient,
  rgbaCssFromHex,
  RASTER_TEMPLATE_DEFAULTS,
  slopeBandsError,
  type SlopeSettings as SlopeSettingsValue,
  type SlopeBand,
} from "@logjam/shared";
import { Button, ColourField, IconButton, InfoTip, LiveNumberField } from "../../../ui";
import { FieldError } from "../../feedback/FieldError";
import type { NumericFieldConstraints } from "../../../numberInput";
import styles from "./topoSettings.module.css";

interface Props {
  value: SlopeSettingsValue;
  onChange: (next: SlopeSettingsValue) => void;
}

const MAX_BANDS = 8;
const DEFAULT_INSERT_WIDTH = 10;
const NEW_BAND_COLOUR = "#ff000080";

// Shipped default scale endpoints — the lowest/highest band colours of the
// canonical default slope ramp (yellow → dark red). Used by the Reset button.
const DEFAULT_BANDS = RASTER_TEMPLATE_DEFAULTS.slope.bands;
const DEFAULT_SCALE_START = DEFAULT_BANDS[0].colour;
const DEFAULT_SCALE_END = DEFAULT_BANDS[DEFAULT_BANDS.length - 1].colour;

const ANGLE_TOOLTIP =
  "Degrees from flat. An easy walk is under 10°, a steep scramble around 30°, and a cliff 45° or " +
  "more. Each band starts where the one below it ends, so its neighbour follows what you set here.";

/**
 * Insert a band at `position` (0..bands.length), keeping the band set a
 * contiguous, ascending cover of integer ranges. Returns null when there is no
 * room. Carving rules:
 *  - position 0: a new lowest band below the transparency threshold (lowers it).
 *  - position bands.length: a new top band toward 90°; if the top is already
 *    90° it carves room from the current last band instead.
 *  - interior: splits the shared boundary, taking the default width from the
 *    neighbour with more room while keeping every band ≥ 1°.
 */
function computeInsert(bands: SlopeBand[], position: number): SlopeBand[] | null {
  if (bands.length >= MAX_BANDS) return null;
  const next = bands.map((b) => ({ ...b }));

  if (position <= 0) {
    const top = next[0].fromDeg;
    if (top <= 0) return null;
    const from = Math.max(0, top - DEFAULT_INSERT_WIDTH);
    if (from >= top) return null;
    next.splice(0, 0, { fromDeg: from, toDeg: top, colour: NEW_BAND_COLOUR });
    return next;
  }

  if (position >= bands.length) {
    const last = next[next.length - 1];
    if (last.toDeg < 90) {
      const to = Math.min(90, last.toDeg + DEFAULT_INSERT_WIDTH);
      next.push({ fromDeg: last.toDeg, toDeg: to, colour: NEW_BAND_COLOUR });
      return next;
    }
    // Top is already 90° — carve room from the current last band.
    const span = last.toDeg - last.fromDeg;
    const width = Math.min(DEFAULT_INSERT_WIDTH, span - 1);
    if (width < 1) return null;
    const boundary = last.toDeg; // 90
    last.toDeg = boundary - width;
    next.push({ fromDeg: boundary - width, toDeg: boundary, colour: NEW_BAND_COLOUR });
    return next;
  }

  const left = next[position - 1];
  const right = next[position];
  const boundary = left.toDeg; // === right.fromDeg
  const leftSpan = left.toDeg - left.fromDeg;
  const rightSpan = right.toDeg - right.fromDeg;
  let width = Math.min(
    DEFAULT_INSERT_WIDTH,
    Math.max(1, Math.floor(Math.max(leftSpan, rightSpan) / 2)),
  );

  if (rightSpan >= leftSpan) {
    width = Math.min(width, rightSpan - 1);
    if (width < 1) return null;
    right.fromDeg = boundary + width;
    next.splice(position, 0, {
      fromDeg: boundary,
      toDeg: boundary + width,
      colour: NEW_BAND_COLOUR,
    });
  } else {
    width = Math.min(width, leftSpan - 1);
    if (width < 1) return null;
    left.toDeg = boundary - width;
    next.splice(position, 0, {
      fromDeg: boundary - width,
      toDeg: boundary,
      colour: NEW_BAND_COLOUR,
    });
  }
  return next;
}

/**
 * Terrain coloured by steepness: a table of bands, its columns headed once
 * (DESIGN.md §9). Every editable number is a unique BOUNDARY owned by exactly
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

  // `applySlopeGradient` always paints the first band exactly the start colour
  // and the last band exactly the end colour, so the endpoints round-trip
  // losslessly through `bands` — derive them here instead of holding parallel
  // state that could drift from the persisted value.
  const scaleStart = bands[0].colour;
  const scaleEnd = bands[bands.length - 1].colour;

  // Recolour a restructured band set along the current scale so inserts,
  // removals and boundary edits keep a clean fade (and new bands never keep the
  // NEW_BAND_COLOUR placeholder).
  const commitBands = (nextBands: SlopeBand[]) => {
    onChange({ ...value, bands: applySlopeGradient(nextBands, scaleStart, scaleEnd) });
  };

  const setScale = (start: string, end: string) => {
    onChange({ ...value, bands: applySlopeGradient(bands, start, end) });
  };

  const setThreshold = (deg: number) => {
    commitBands(bands.map((b, i) => (i === 0 ? { ...b, fromDeg: deg } : b)));
  };

  const setUpper = (idx: number, deg: number) => {
    const nextBands = bands.map((b) => ({ ...b }));
    nextBands[idx].toDeg = deg;
    if (idx < nextBands.length - 1) nextBands[idx + 1].fromDeg = deg;
    commitBands(nextBands);
  };

  const removeBand = (idx: number) => {
    const nextBands = bands.filter((_, i) => i !== idx).map((b) => ({ ...b }));
    // Re-stitch contiguity: if an interior band was removed, close the gap by
    // extending the previous band up to where the next band starts.
    if (idx > 0 && idx < nextBands.length) {
      nextBands[idx - 1].toDeg = nextBands[idx].fromDeg;
    }
    commitBands(nextBands);
  };

  const insertAt = (position: number) => {
    const nextBands = computeInsert(bands, position);
    if (nextBands) commitBands(nextBands);
  };

  const error = slopeBandsError(bands);

  const insertControl = (position: number) => {
    const room = computeInsert(bands, position) !== null;
    return (
      <button
        type="button"
        className={styles.insertRow}
        title={room ? "Add a band here" : "Eight bands is the most a topo can have"}
        aria-label={room ? "Add a band here" : "Eight bands is the most a topo can have"}
        disabled={!room}
        onClick={() => insertAt(position)}
      >
        <Plus size={14} aria-hidden />
      </button>
    );
  };

  const boundaryConstraints = (min: number, max: number): NumericFieldConstraints => ({
    min,
    max,
    integer: true,
  });

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Colour terrain based on how steep it is.
      </p>

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
        <Button
          compact
          variant="outline"
          className={styles.scaleReset}
          onClick={() => setScale(DEFAULT_SCALE_START, DEFAULT_SCALE_END)}
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
          constraints={boundaryConstraints(0, bands[0].toDeg - 1)}
          onCommit={setThreshold}
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
              constraints={boundaryConstraints(
                band.fromDeg + 1,
                idx < bands.length - 1 ? bands[idx + 1].toDeg - 1 : 90,
              )}
              onCommit={(deg) => setUpper(idx, deg)}
            />
            <span
              className={styles.bandSwatch}
              role="img"
              aria-label={`Band ${idx + 1} colour, taken from the scale`}
            >
              <span
                className={styles.bandSwatchFill}
                style={{ "--band-colour": rgbaCssFromHex(band.colour) } as CSSProperties}
              />
            </span>
            {bands.length > 1 ? (
              <IconButton icon={Trash2} label={`Remove band ${idx + 1}`} onClick={() => removeBand(idx)} />
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
