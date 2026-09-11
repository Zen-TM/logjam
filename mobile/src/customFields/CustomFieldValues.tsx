// The user's own fields, as inputs on an entity form — one implementation for
// trips and places, because the two forms ask the same question of the same
// definition list and a second copy would drift the moment a type is added.
//
// Values are held as STRINGS while editing (like the web's forms) and coerced
// to their declared type on save, so a half-typed "-" or "12." is never a
// parse error mid-keystroke.
//
// A date field opens the sheet's own date picker rather than asking the user to
// type an ISO string, which is why `onPickDate` is a callback: the picker is a
// MODE of the host sheet (DESIGN.md §6 — never a second modal), and only the
// host knows how to enter it.
import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import {
  customFieldDisplayLabel,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import { formatDateKey } from "../logs/logbook";
import { fontSize, spacing, theme } from "../theme";
import { Row, SegmentedControl, TextField, Toggle, type SegmentOption } from "../ui";

/**
 * The widest span that still reads as a rail rather than a ruler.
 *
 * A bounded integer is drawn as a row of stops instead of a number box, which
 * is how the canyon grades have always been drawn — they just used to be seven
 * hand-written controls in `PlaceEditSheet` with their keys spelled out. They
 * are ordinary bounded integers, so the rail is now a property of the TYPE and
 * every field that shares that shape gets it: a user's own "Difficulty, 1-5"
 * is drawn exactly like the V grade, without knowing anything about canyons.
 *
 * Above this the stops stop being tappable and a keyboard is faster. `hours`
 * and `num_abseils` are unbounded and were never rail candidates.
 */
const MAX_RAIL_STOPS = 12;

/** Every definition as an input, in the user's own order. */
export function CustomFieldValueInputs({
  defs,
  values,
  onChange,
  onPickDate,
}: {
  defs: TripLogCustomFieldDef[];
  values: Record<string, string>;
  onChange: (key: string, next: string) => void;
  /** Enter the host sheet's date-picker mode for this field. */
  onPickDate: (key: string) => void;
}) {
  return (
    <>
      {defs.map((def) => (
        <CustomFieldValueInput
          key={def.key}
          def={def}
          value={values[def.key] ?? (def.type === "boolean" ? "false" : "")}
          onChange={(next) => onChange(def.key, next)}
          onPickDate={() => onPickDate(def.key)}
        />
      ))}
    </>
  );
}

/** One value input, shaped by the field's declared type. */
function CustomFieldValueInput({
  def,
  value,
  onChange,
  onPickDate,
}: {
  def: TripLogCustomFieldDef;
  value: string;
  onChange: (next: string) => void;
  onPickDate: () => void;
}) {
  const label = customFieldDisplayLabel(def);
  // A BOUNDED INTEGER IS A RAIL. Unset has to stay reachable — most imported
  // places have gaps, and a picker with no way back to blank turns "I don't
  // know" into a wrong answer, which is why the first stop is "—".
  const stops = railStops(def);
  if (stops) {
    const options: SegmentOption<string>[] = [{ value: "", label: "—" }];
    for (const stop of stops) options.push({ value: String(stop), label: String(stop) });
    return (
      <View style={styles.field}>
        <Text style={styles.railLabel}>{def.label}</Text>
        <SegmentedControl scroll options={options} value={value} onChange={onChange} />
      </View>
    );
  }
  if (def.type === "boolean") {
    return (
      <Row
        icon="check-square"
        title={label}
        right={
          <Toggle
            value={value === "true"}
            onValueChange={(next) => onChange(next ? "true" : "false")}
            accessibilityLabel={label}
          />
        }
      />
    );
  }
  if (def.type === "date") {
    return (
      <Row
        icon="calendar"
        title={value ? formatDateKey(`${value}T00:00:00.000Z`) : "Not set"}
        subtitle={label}
        right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
        onPress={onPickDate}
      />
    );
  }
  return (
    <View style={styles.field}>
      <TextField
        label={label}
        value={value}
        onChangeText={onChange}
        keyboardType={
          def.type === "integer"
            ? "number-pad"
            : def.type === "float"
              ? "decimal-pad"
              : "default"
        }
        autoCapitalize="sentences"
      />
    </View>
  );
}

/** The stops a bounded integer draws, or null when it is not rail-shaped.
 *  Derived from the definition's own bounds, which is the only place they are
 *  declared — a rail that restated 1-7 would drift from the field it draws. */
function railStops(def: TripLogCustomFieldDef): number[] | null {
  if (def.type !== "integer") return null;
  if (def.min == null || def.max == null) return null;
  const span = def.max - def.min;
  if (span < 1 || span + 1 > MAX_RAIL_STOPS) return null;
  const stops: number[] = [];
  for (let stop = def.min; stop <= def.max; stop += 1) stops.push(stop);
  return stops;
}

const styles = StyleSheet.create({
  field: { gap: spacing(0.5) },
  railLabel: { color: theme.textPrimary, fontSize: fontSize.sm },
});
