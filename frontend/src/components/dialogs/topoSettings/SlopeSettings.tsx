import { Fragment, useEffect, useState } from "react";
import {
  applySlopeGradient,
  rgbaCssFromHex,
  RASTER_TEMPLATE_DEFAULTS,
  slopeBandsError,
  type SlopeSettings as SlopeSettingsValue,
  type SlopeBand,
} from "@logjam/shared";
import ColourPicker from "../../common/ColourPicker";
import { Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
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

export default function SlopeSettings({ value, onChange }: Props) {
  const bands = value.bands;

  // Band colours are driven by a two-stop scale rather than picked per band.
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
  const resetScale = () => setScale(DEFAULT_SCALE_START, DEFAULT_SCALE_END);

  // Editing model: every editable number is a unique boundary, owned by exactly
  // one input — the transparency threshold (band[0].fromDeg) and each band's
  // upper angle (band[i].toDeg). A band's lower angle is read-only (it mirrors
  // the band below's upper). This makes gaps/overlaps structurally impossible.
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
  const canInsertAt = (position: number) => computeInsert(bands, position) !== null;

  const error = slopeBandsError(bands);

  const insertControl = (position: number) => (
    <div className={styles.insertRow}>
      <Tooltip
        title={
          bands.length >= MAX_BANDS
            ? `Maximum ${MAX_BANDS} bands reached`
            : "Insert a new band here"
        }
        placement="top"
        arrow
      >
        <span style={{ display: "inline-block" }}>
          <button
            type="button"
            className={styles.insertButton}
            onClick={() => insertAt(position)}
            disabled={!canInsertAt(position)}
            aria-label="Insert a new slope band here"
          >
            +
          </button>
        </span>
      </Tooltip>
    </div>
  );

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Slope bands colour terrain by steepness. Pixels below the transparency
        threshold are transparent. Each band&rsquo;s lower angle is fixed to the
        band below it — edit a band&rsquo;s upper angle (or the threshold) and
        the neighbour follows. Use the <strong>+</strong> between rows to insert
        a band ({bands.length}/{MAX_BANDS}). Band colours are computed along the
        scale below — pick a start and end colour and each band fades between
        them by its steepness.
      </p>

      <div className={styles.scaleRow}>
        <span className={styles.scaleEndpoint}>
          <span className={styles.scaleLabel}>Scale start</span>
          <ColourPicker
            value={scaleStart}
            onChange={(c) => setScale(c, scaleEnd)}
            ariaLabel="Scale start colour (lowest band)"
          />
        </span>
        <span className={styles.scaleArrow} aria-hidden="true">→</span>
        <span className={styles.scaleEndpoint}>
          <span className={styles.scaleLabel}>Scale end</span>
          <ColourPicker
            value={scaleEnd}
            onChange={(c) => setScale(scaleStart, c)}
            ariaLabel="Scale end colour (highest band)"
          />
        </span>
        <Tooltip title="Reset the scale to the default yellow → dark-red ramp" placement="top" arrow>
          <button type="button" className={styles.scaleReset} onClick={resetScale}>
            Reset
          </button>
        </Tooltip>
      </div>

      <div className={styles.bandTable}>
        <span className={styles.bandHeaderCell}>
          <span className={styles.bandHeader}>From °</span>
          <Tooltip title="Slope angle in degrees from horizontal. Flat ground ≈ 0–5°; steep trail ≈ 20–30°; cliff / technical terrain ≈ 45°+." placement="top" arrow>
            <InfoOutlinedIcon className={styles.infoIcon} />
          </Tooltip>
        </span>
        <span className={styles.bandHeaderCell}>
          <span className={styles.bandHeader}>To °</span>
          <Tooltip title="Upper bound of this band in degrees. The next band starts here automatically." placement="top" arrow>
            <InfoOutlinedIcon className={styles.infoIcon} />
          </Tooltip>
        </span>
        <span className={styles.bandHeader}>Colour</span>
        <span />

        {/* Transparency threshold = band[0].fromDeg, editable. */}
        <span className={styles.lockedCell}>0</span>
        <BoundaryInput
          value={bands[0].fromDeg}
          min={0}
          max={bands[0].toDeg - 1}
          onCommit={setThreshold}
          label="Transparency threshold (degrees)"
        />
        <span className={styles.lockedCell}>Transparent</span>
        <span />

        {insertControl(0)}
        {bands.map((band, idx) => (
          <Fragment key={idx}>
            <span className={styles.lockedCell}>{band.fromDeg}</span>
            <BoundaryInput
              value={band.toDeg}
              min={band.fromDeg + 1}
              max={idx < bands.length - 1 ? bands[idx + 1].toDeg - 1 : 90}
              onCommit={(deg) => setUpper(idx, deg)}
              label={`Band ${idx + 1} upper angle (degrees)`}
            />
            <span
              className={styles.readonlySwatch}
              role="img"
              aria-label={`Band ${idx + 1} colour (from the scale)`}
            >
              <span
                className={styles.readonlySwatchFill}
                style={{ background: rgbaCssFromHex(band.colour) }}
              />
            </span>
            {bands.length > 1 ? (
              <button type="button" className={styles.removeButton} onClick={() => removeBand(idx)}>
                Remove
              </button>
            ) : (
              <span />
            )}
            {insertControl(idx + 1)}
          </Fragment>
        ))}
      </div>

      {error && (
        <p className={styles.bandError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface BoundaryInputProps {
  value: number;
  min: number;
  max: number;
  onCommit: (deg: number) => void;
  label: string;
}

/**
 * A single integer-degree boundary input. Holds draft text so the user can
 * clear and retype freely while focused, but commits live whenever the current
 * text is a valid in-range integer — so the native spinner buttons and keyboard
 * arrows (both fire `onChange`, never blur/keydown) immediately update the model
 * and the linked neighbour. The draft is only resynced from `value` while NOT
 * focused, so a live commit never clamps the text mid-keystroke. Blur does the
 * final clamp/revert. Each boundary is owned by one input, so commits never
 * fight an adjacent field.
 */
function BoundaryInput({ value, min, max, onCommit, label }: BoundaryInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  const isValid = (n: number) => Number.isInteger(n) && n >= min && n <= max;

  return (
    <input
      type="number"
      className={styles.numberInput}
      min={min}
      max={max}
      step={1}
      value={draft}
      aria-label={label}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        // Commit live for any valid in-range value — covers spinner clicks and
        // arrow keys. Partial/empty/out-of-range text stays in the draft and is
        // resolved on blur.
        const n = Number(raw);
        if (raw.trim() !== "" && isValid(n) && n !== value) onCommit(n);
      }}
      onBlur={(e) => {
        setFocused(false);
        const raw = e.target.value;
        if (raw.trim() === "" || !Number.isFinite(Number(raw))) {
          setDraft(String(value)); // revert invalid/empty entry
          return;
        }
        const clamped = clamp(Number(raw));
        setDraft(String(clamped));
        if (clamped !== value) onCommit(clamped);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
