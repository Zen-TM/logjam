// How every LiDAR topo draws its vector layers: label size, contour lines, and
// the OpenStreetMap features laid over the terrain.
//
// A SIDE SHEET beside the LiDAR topos view, not an accordion inside it. These
// are styles someone tunes by watching the map change, and a sheet beside the
// panel leaves the map in view and live — the reason filters open that way too
// (DESIGN.md §2). It was an accordion at the bottom of the page with its own
// Contours | Features tab strip, so a colour change happened with the map's
// answer scrolled out of sight.
//
// Every change applies at once: App's `useLiveVectorStyle` draws it and
// debounces the save (PUT /vector-style). Nothing here saves, and the sheet says
// neither — a sheet of controls that change the map while you watch does not
// need a paragraph explaining that it does (operator, 2026-09-18).
import { useId } from "react";
import {
  CONTOUR_WIDTH_UNITS_PER_PX,
  LABEL_SCALE_MAX,
  LABEL_SCALE_MIN,
  OSM_FEATURE_LABELS,
  OSM_FEATURE_TAG_HINTS,
  OSM_LINE_FEATURE_KEYS,
  OSM_POINT_FEATURE_KEYS,
  type OsmFeatureKey,
  type OsmFeatureStyle,
  type OsmPointFeatureKey,
  type VectorStyleSettings,
} from "@logjam/shared";
import { ColourField, LiveNumberField, RangeField, SheetSection, SideSheet, Toggle } from "../../../ui";
import classes from "./MapsPanel.module.css";

/** The fixed topographic icon each point feature is drawn with. */
const POINT_ICON: Record<OsmPointFeatureKey, string> = {
  campsite: "campsite.png",
  peak: "peak.png",
  spring: "spring.png",
  gate: "gate.png",
  cave: "cave.png",
  ford: "ford.png",
  waterfall: "waterfall.png",
  trailhead: "trailhead.png",
  viewpoint: "viewpoint.png",
  hut: "hut.png",
};

// Every width on this sheet is ONE unit: the line's thickness in pixels at the
// closest zoom. A contour is stored in eighths of that (`majorWidthM`, named for
// ground metres it has never been measured in), so it is divided on the way in
// and multiplied on the way out — otherwise two boxes side by side take the same
// number and draw lines eight times apart (operator, 2026-09-18).
const toPixels = (stored: number) => stored / CONTOUR_WIDTH_UNITS_PER_PX;
const toStored = (pixels: number) => pixels * CONTOUR_WIDTH_UNITS_PER_PX;

/** The widest each kind goes, as the server's own bounds allow (0..200 stored
 *  for a contour, 0..100 pixels for a feature). */
const CONTOUR_WIDTH_MAX = toPixels(200);
const FEATURE_WIDTH_MAX = 100;

/** What the cells under each heading hold. */
const DRAWN_COLUMNS = ["Colour", "Width"] as const;
const SYMBOL_COLUMNS = ["Symbol"] as const;

/** The two contour weights, so the table is a list rather than two copies. */
const CONTOUR_LINES = [
  { name: "Major", colourKey: "majorColour", widthKey: "majorWidthM" },
  { name: "Minor", colourKey: "minorColour", widthKey: "minorWidthM" },
] as const;

export default function TopoStyleSheet({
  value,
  onChange,
  onClose,
}: {
  /** Null until the stored style has loaded. */
  value: VectorStyleSettings | null;
  onChange: (next: VectorStyleSettings) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <SideSheet title="Topo style" onClose={onClose}>
      {value === null ? (
        <p className={classes.note} role="status">
          Loading your topo style…
        </p>
      ) : (
        <StyleForm value={value} onChange={onChange} />
      )}
    </SideSheet>
  );
}

function StyleForm({ value, onChange }: { value: VectorStyleSettings; onChange: (next: VectorStyleSettings) => void }) {
  const contours = value.contours;
  const setContours = (delta: Partial<VectorStyleSettings["contours"]>) =>
    onChange({ ...value, contours: { ...contours, ...delta } });
  const setFeature = (key: OsmFeatureKey, delta: Partial<OsmFeatureStyle>) =>
    onChange({ ...value, features: { ...value.features, [key]: { ...value.features[key], ...delta } } });

  return (
    <>
      <SheetSection title="Labels">
        <RangeField
          label="Label size"
          min={LABEL_SCALE_MIN}
          max={LABEL_SCALE_MAX}
          step={0.1}
          value={value.labelScale ?? 1}
          format={(scale) => `${scale.toFixed(1)}×`}
          onChange={(labelScale) => onChange({ ...value, labelScale })}
        />
      </SheetSection>

      {/* A TABLE: a colour column and a width column, headed once. The boxes
          were bare numbers with nothing saying what they set, and a label
          beside each said "Major"/"Minor" twice over (operator, 2026-09-18). */}
      <SheetSection title="Contours">
        <div className={classes.styleTable}>
          <ColumnHeads columns={DRAWN_COLUMNS} />
          {CONTOUR_LINES.map(({ name, colourKey, widthKey }) => (
            <StyleRow key={name} name={name}>
              <ColourField
                label={`${name} colour`}
                hideLabel
                value={contours[colourKey]}
                onChange={(colour) => setContours({ [colourKey]: colour })}
              />
              <WidthBox
                label={`${name} width`}
                value={toPixels(contours[widthKey])}
                max={CONTOUR_WIDTH_MAX}
                onChange={(pixels) => setContours({ [widthKey]: toStored(pixels) })}
              />
            </StyleRow>
          ))}
        </div>
      </SheetSection>

      {/* "OSM" in the heading, not a sentence under it saying where the lines
          come from: the heading has room for the one word that carries it. */}
      <SheetSection title="OSM lines">
        <div className={`${classes.styleTable} ${classes.switchTable}`}>
          <ColumnHeads columns={DRAWN_COLUMNS} switched />
          {OSM_LINE_FEATURE_KEYS.map((key) => {
            const style = value.features[key];
            const label = OSM_FEATURE_LABELS[key];
            return (
              <StyleRow
                key={key}
                feature={key}
                name={label}
                hint={OSM_FEATURE_TAG_HINTS[key]}
                // Present while off, not removed: the style is kept for when
                // the feature comes back on (DESIGN.md §7).
                enabled={style.enabled}
                onEnabledChange={(enabled) => setFeature(key, { enabled })}
              >
                <ColourField
                  label={`${label} colour`}
                  hideLabel
                  value={style.colour}
                  disabled={!style.enabled}
                  onChange={(colour) => setFeature(key, { colour })}
                />
                <WidthBox
                  label={`${label} width`}
                  value={style.widthZ18}
                  max={FEATURE_WIDTH_MAX}
                  disabled={!style.enabled}
                  onChange={(widthZ18) => setFeature(key, { widthZ18 })}
                />
              </StyleRow>
            );
          })}
        </div>
      </SheetSection>

      {/* The same table: a point has no colour or width to set, so the one
          thing that says how it is drawn is its fixed symbol. */}
      <SheetSection title="OSM points">
        <div className={`${classes.styleTable} ${classes.symbolTable}`}>
          <ColumnHeads columns={SYMBOL_COLUMNS} switched />
          {OSM_POINT_FEATURE_KEYS.map((key) => (
            <StyleRow
              key={key}
              feature={key}
              name={OSM_FEATURE_LABELS[key]}
              hint={OSM_FEATURE_TAG_HINTS[key]}
              enabled={value.features[key].enabled}
              onEnabledChange={(enabled) => setFeature(key, { enabled })}
            >
              {/* Decorative: the row's own name says which feature this is. */}
              <img src={`/topo-icons/${POINT_ICON[key]}`} alt="" className={classes.pointIcon} />
            </StyleRow>
          ))}
        </div>
      </SheetSection>
    </>
  );
}

/** The one line that says what the columns under it are. A width box with
 *  nothing over it is a number with no noun (operator, 2026-09-18). */
function ColumnHeads({ columns, switched = false }: { columns: readonly string[]; switched?: boolean }) {
  return (
    <>
      <span />
      {columns.map((column) => (
        <span key={column} className={classes.head}>
          {column}
        </span>
      ))}
      {switched && <span />}
    </>
  );
}

/**
 * One line of the table: what it is at the left, then the cells that say how it
 * is drawn, then — for an OSM feature — its switch. The cells are the grid's
 * own, not a box of their own: a feature's colour and width sat on a row below
 * its switch, right-aligned, two small controls adrift in an empty line
 * (operator, 2026-09-18).
 *
 * The name is text, not a label: each control carries its own accessible name,
 * which CONTAINS the visible word (WCAG 2.5.3). The switch takes the name and
 * the hint as its own, the way `SwitchRow` wires them.
 */
function StyleRow({
  feature,
  name,
  hint,
  enabled,
  onEnabledChange,
  children,
}: {
  feature?: string;
  name: string;
  hint?: string;
  /** Omitted for a contour, which is drawn whenever contours are. */
  enabled?: boolean;
  onEnabledChange?: (next: boolean) => void;
  children: React.ReactNode;
}) {
  const nameId = useId();
  const hintId = useId();
  return (
    <>
      <div className={classes.rowText} data-feature={feature}>
        <span id={nameId} className={classes.rowName}>
          {name}
        </span>
        {hint && (
          <span id={hintId} className={classes.rowHint}>
            {hint}
          </span>
        )}
      </div>
      {children}
      {onEnabledChange && (
        <Toggle
          checked={enabled ?? true}
          onChange={onEnabledChange}
          labelledBy={nameId}
          describedBy={hint ? hintId : undefined}
        />
      )}
    </>
  );
}

/**
 * A width: a box in the table's width column, named by the heading over it and
 * by the row beside it, so it carries no label of its own. The kit's
 * `LiveNumberField` holds the typing, so the map follows each valid digit and
 * never sees a half-typed one.
 */
function WidthBox({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <LiveNumberField
      label={label}
      hideLabel
      className={classes.widthBox}
      value={value}
      constraints={{ min: 0, max }}
      disabled={disabled}
      onCommit={onChange}
    />
  );
}
