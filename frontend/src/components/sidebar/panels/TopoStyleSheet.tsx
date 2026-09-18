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
import { useEffect, useState } from "react";
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
import { ColourField, NumberField, SheetSection, SideSheet, SwitchRow } from "../../../ui";
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
        <NumberLine
          label="Label size"
          value={value.labelScale ?? 1}
          min={LABEL_SCALE_MIN}
          max={LABEL_SCALE_MAX}
          onChange={(labelScale) => onChange({ ...value, labelScale })}
        />
      </SheetSection>

      {/* Colour and width on ONE line per contour, a colour column and a width
          column down the section: two lines each, with "Major"/"Minor" said
          twice, spent four lines saying what a two-column table says in two
          (operator, 2026-09-18). */}
      <SheetSection title="Contours">
        <StyleLine
          name="Major"
          colour={contours.majorColour}
          onColour={(majorColour) => setContours({ majorColour })}
          width={toPixels(contours.majorWidthM)}
          widthMax={CONTOUR_WIDTH_MAX}
          onWidth={(pixels) => setContours({ majorWidthM: toStored(pixels) })}
        />
        <StyleLine
          name="Minor"
          colour={contours.minorColour}
          onColour={(minorColour) => setContours({ minorColour })}
          width={toPixels(contours.minorWidthM)}
          widthMax={CONTOUR_WIDTH_MAX}
          onWidth={(pixels) => setContours({ minorWidthM: toStored(pixels) })}
        />
      </SheetSection>

      {/* "OSM" in the heading, not a sentence under it saying where the lines
          come from: the heading has room for the one word that carries it. */}
      <SheetSection title="OSM lines">
        {OSM_LINE_FEATURE_KEYS.map((key) => {
          const style = value.features[key];
          const label = OSM_FEATURE_LABELS[key];
          return (
            <div key={key} className={classes.feature} data-feature={key}>
              <SwitchRow
                title={label}
                description={OSM_FEATURE_TAG_HINTS[key]}
                checked={style.enabled}
                onChange={(enabled) => setFeature(key, { enabled })}
              />
              {/* Present while off, not removed: the style is kept for when the
                  feature is turned back on (DESIGN.md §7, absent vs disabled).
                  The switch above names them, so the colour and the width are
                  the line — one line, as the contours are. */}
              <div className={classes.featureControls}>
                <ColourField
                  label={`Colour of ${label.toLowerCase()}`}
                  hideLabel
                  value={style.colour}
                  disabled={!style.enabled}
                  onChange={(colour) => setFeature(key, { colour })}
                />
                <WidthBox
                  label={`Width of ${label.toLowerCase()}`}
                  value={style.widthZ18}
                  max={FEATURE_WIDTH_MAX}
                  disabled={!style.enabled}
                  onChange={(widthZ18) => setFeature(key, { widthZ18 })}
                />
              </div>
            </div>
          );
        })}
      </SheetSection>

      <SheetSection title="OSM points">
        {OSM_POINT_FEATURE_KEYS.map((key) => (
          <div key={key} className={classes.pointFeature} data-feature={key}>
            {/* Decorative: the switch beside it is named by the feature. */}
            <img src={`/topo-icons/${POINT_ICON[key]}`} alt="" className={classes.pointIcon} />
            <SwitchRow
              title={OSM_FEATURE_LABELS[key]}
              description={OSM_FEATURE_TAG_HINTS[key]}
              checked={value.features[key].enabled}
              onChange={(enabled) => setFeature(key, { enabled })}
            />
          </div>
        ))}
      </SheetSection>
    </>
  );
}

/** A named line of the style: what it is at the left, its colour and its width
 *  at the right. The name is text, not a label — each control carries its own
 *  accessible name, which CONTAINS the visible word (WCAG 2.5.3). */
function StyleLine({
  name,
  colour,
  onColour,
  width,
  widthMax,
  onWidth,
}: {
  name: string;
  colour: string;
  onColour: (next: string) => void;
  width: number;
  widthMax: number;
  onWidth: (next: number) => void;
}) {
  return (
    <div className={classes.styleLine} data-style-line={name.toLowerCase()}>
      <span className={classes.styleName}>{name}</span>
      <ColourField label={`${name} colour`} hideLabel value={colour} onChange={onColour} />
      <WidthBox label={`${name} width`} value={width} max={widthMax} onChange={onWidth} />
    </div>
  );
}

/**
 * A width: a box sized for a few digits, with no visible label — the name at
 * the left of its line, or the switch above it, already says what it is.
 *
 * Typed as text and applied the moment it is a valid number. The draft is held
 * here so a half-typed "1." or an empty box does not reach the map (or the
 * server's 0–max check), and is replaced if the value changes elsewhere.
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
    <LiveNumber
      label={label}
      hideLabel
      className={classes.widthBox}
      value={value}
      min={0}
      max={max}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

/** The same number, with its label visible at the left of the line. */
function NumberLine(props: { label: string; value: number; min: number; max: number; onChange: (next: number) => void }) {
  return <LiveNumber {...props} className={classes.numberLine} />;
}

function LiveNumber({
  label,
  hideLabel,
  className,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  hideLabel?: boolean;
  className: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <NumberField
      label={label}
      hideLabel={hideLabel}
      className={className}
      value={draft}
      constraints={{ min, max }}
      disabled={disabled}
      onChange={(next) => {
        setDraft(next);
        const number = Number(next);
        if (next.trim() !== "" && Number.isFinite(number) && number >= min && number <= max) onChange(number);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
