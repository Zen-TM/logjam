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
// debounces the save (PUT /vector-style). Nothing here saves.
import { useEffect, useState } from "react";
import {
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
import { ColourField, NumberField, RangeField, SheetSection, SideSheet, SwitchRow } from "../../../ui";
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
      <p className={classes.note}>
        Changes show at once on every LiDAR topo on the map. A topo made from now on also takes this style into its
        map image.
      </p>

      <SheetSection title="Labels">
        <RangeField
          label="Label size"
          hint="Contour heights and feature names, on the map and in exports."
          min={LABEL_SCALE_MIN}
          max={LABEL_SCALE_MAX}
          step={0.1}
          value={value.labelScale ?? 1}
          format={(scale) => `${scale.toFixed(1)}×`}
          onChange={(labelScale) => onChange({ ...value, labelScale })}
        />
      </SheetSection>

      <SheetSection title="Contours">
        <p className={classes.note}>Widths are metres on the ground.</p>
        <ColourField label="Major colour" value={contours.majorColour} onChange={(majorColour) => setContours({ majorColour })} />
        <WidthField
          label="Major width"
          accessibleLabel="Major width, in metres"
          value={contours.majorWidthM}
          max={200}
          onChange={(majorWidthM) => setContours({ majorWidthM })}
        />
        <ColourField label="Minor colour" value={contours.minorColour} onChange={(minorColour) => setContours({ minorColour })} />
        <WidthField
          label="Minor width"
          accessibleLabel="Minor width, in metres"
          value={contours.minorWidthM}
          max={200}
          onChange={(minorWidthM) => setContours({ minorWidthM })}
        />
      </SheetSection>

      <SheetSection title="Lines">
        <p className={classes.note}>From OpenStreetMap. Widths are pixels at the closest zoom, and scale with the map.</p>
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
                  feature is turned back on (DESIGN.md §7, absent vs disabled). */}
              <div className={classes.featureControls}>
                <ColourField
                  label={`Colour of ${label.toLowerCase()}`}
                  value={style.colour}
                  disabled={!style.enabled}
                  onChange={(colour) => setFeature(key, { colour })}
                />
                <WidthField
                  label="Width"
                  accessibleLabel={`Width of ${label.toLowerCase()}, in pixels at the closest zoom`}
                  value={style.widthZ18}
                  max={100}
                  disabled={!style.enabled}
                  onChange={(widthZ18) => setFeature(key, { widthZ18 })}
                />
              </div>
            </div>
          );
        })}
      </SheetSection>

      <SheetSection title="Points">
        <p className={classes.note}>From OpenStreetMap, each with its own topographic symbol.</p>
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

/**
 * A width, as a LINE like the colour above it: its label at the left and a box
 * sized for a few digits at the right, where a full-width field for "3" read as
 * a place to write a sentence.
 *
 * Typed as text and applied the moment it is a valid number. The draft
 * is held here so a half-typed "1." or an empty box does not reach the map (or
 * the server's 0–max check) — and is replaced if the value changes elsewhere.
 */
function WidthField({
  label,
  accessibleLabel,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string;
  accessibleLabel: string;
  value: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const constraints = { min: 0, max };
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <NumberField
      label={label}
      aria-label={accessibleLabel}
      className={classes.width}
      value={draft}
      constraints={constraints}
      disabled={disabled}
      onChange={(next) => {
        setDraft(next);
        const number = Number(next);
        if (next.trim() !== "" && Number.isFinite(number) && number >= 0 && number <= max) onChange(number);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
