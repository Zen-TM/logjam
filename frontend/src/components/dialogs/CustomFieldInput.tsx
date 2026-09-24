import type { TripLogCustomFieldDef } from "@logjam/shared";
import {
  customFieldDisplayLabel,
  railStops,
  systemFieldDef,
} from "@logjam/shared";
import { numericFieldError, type NumericFieldConstraints } from "../../numberInput";
import { ChipRail, NumberField, TextField } from "../../ui";
import classes from "./CustomFieldInput.module.css";

/** The stop that means "no answer". Unset has to stay reachable: most imported
 *  places have gaps, and a picker with no way back to blank turns "I don't
 *  know" into a wrong answer. */
const UNSET = "";

/** A yes/no is THREE states, "—" first, as on Logjam GPS. A checkbox has no
 *  empty state, so it wrote `false` for every yes/no the form showed — a "No"
 *  nobody gave, kept after the trip was retagged and counted as answered. */
const BOOLEAN_OPTIONS = [
  { value: UNSET, label: "—" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

/**
 * Numeric constraints for a custom field. Integer-ness comes from the field
 * type; the declared min/max (only present on "bounded" fields) become the
 * range. Unbounded numeric custom fields have no range — a temperature integer
 * can legitimately be negative — so only whole-number-ness is enforced there.
 */
function customFieldConstraints(
  def: TripLogCustomFieldDef,
): NumericFieldConstraints {
  return { integer: def.type === "integer", min: def.min, max: def.max };
}

/**
 * Inline validation error for a custom field's raw string value, or null.
 * Only numeric (integer/float) fields can be invalid. Used by both the input
 * below (to render the error) and the dialogs (to block Save). Pure.
 */
export function customFieldValueError(
  def: TripLogCustomFieldDef,
  value: string,
): string | null {
  if (def.type !== "integer" && def.type !== "float") return null;
  return numericFieldError(value, customFieldConstraints(def));
}

/**
 * A single attribute's input, shared between PlaceDialog and TripLogDialog so
 * the two cannot drift (UX-002/UX-003). The control is chosen by the
 * definition's SHAPE, never by its key — the same rule the filter sheet
 * follows (`filterPillStops`, DESIGN.md §2) and the same one Logjam GPS's
 * `CustomFieldValueInput` follows.
 *
 * A BOUNDED INTEGER IS A RAIL (`railStops`, shared). That is how the seven
 * canyon grades are drawn now: they are ordinary bounded integers, so a user's
 * own "Difficulty, 1-5" is drawn exactly like the V grade without anything
 * here knowing that canyons exist. They used to be seven hand-written selects
 * in `PlaceDialog` with their reserved keys spelled out.
 *
 * `value` is the raw form string; "" is unset for every type, a yes/no
 * included (`BOOLEAN_OPTIONS`).
 */
function CustomFieldInput({
  def,
  value,
  onChange,
  showError = false,
}: {
  def: TripLogCustomFieldDef;
  value: string;
  onChange: (value: string) => void;
  // Force the inline error to show even before blur (Save attempt).
  showError?: boolean;
}) {
  const label = customFieldDisplayLabel(def);
  // What the label cannot say — the scale, what it is measured between. Only a
  // built-in carries one; a user wrote their own label (DESIGN.md §9: a hint
  // is visible and read with the control, where a tooltip is neither).
  const hint = systemFieldDef(def.key)?.hint;

  const stops = railStops(def);
  if (stops) {
    return (
      <div className={classes.rail}>
        <span className={classes.railLabel}>{def.label}</span>
        <ChipRail
          label={def.label}
          options={[
            { value: UNSET, label: "—" },
            ...stops.map((stop) => ({ value: String(stop), label: String(stop) })),
          ]}
          value={value}
          onChange={onChange}
        />
        {hint && <p className={classes.railHint}>{hint}</p>}
      </div>
    );
  }

  if (def.type === "boolean") {
    return (
      <div className={classes.rail}>
        <span className={classes.railLabel}>{label}</span>
        <ChipRail label={label} options={BOOLEAN_OPTIONS} value={value} onChange={onChange} />
      </div>
    );
  }

  if (def.type === "integer" || def.type === "float") {
    // A decimal typed into an integer field shows "Whole numbers only" instead
    // of being silently truncated (TRIP-1), and an out-of-range value on a
    // bounded field is flagged instead of silently clamped (TRIP-2).
    return (
      <NumberField
        label={label}
        hint={hint}
        value={value}
        onChange={onChange}
        constraints={customFieldConstraints(def)}
        showError={showError}
      />
    );
  }

  return (
    <TextField
      label={label}
      hint={hint}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      type={def.type === "date" ? "date" : "text"}
    />
  );
}

export default CustomFieldInput;
