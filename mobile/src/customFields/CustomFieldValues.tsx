// The user's own fields, as inputs on an entity form — one implementation for
// trips and canyons, because the two forms ask the same question of the same
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
import { StyleSheet, View } from "react-native";
import {
  coerceFieldValue,
  customFieldDisplayLabel,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import { formatDateKey } from "../logs/logbook";
import { spacing, theme } from "../theme";
import { Row, TextField, Toggle } from "../ui";

/** Seed the editing state from stored values: everything as a string, and a
 *  missing value as "" (or "false" for a toggle, which has no empty state). */
export function fieldValueStrings(
  stored: Record<string, unknown> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(stored ?? {}).map(([key, value]) => [
      key,
      value == null ? "" : String(value),
    ]),
  );
}

/**
 * String form → stored value, using the shared coercion so a number typed here
 * lands as a number, not a string. An empty value drops the key entirely rather
 * than storing "" — a field with no answer should read as unset, and the detail
 * screens' "—" placeholder depends on it.
 */
export function coerceCustomFields(
  values: Record<string, string>,
  defs: TripLogCustomFieldDef[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const def of defs) {
    const raw = values[def.key];
    if (raw == null || raw.trim() === "") continue;
    if (def.type === "boolean" && raw === "false") continue;
    result[def.key] = coerceFieldValue(raw, def.type);
  }
  return result;
}

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

const styles = StyleSheet.create({
  field: { gap: spacing(0.5) },
});
