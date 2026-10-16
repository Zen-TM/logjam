// The user's own fields, as inputs on an entity form and as the read-only table
// a detail screen shows — one implementation for trips and places, because the
// two ask the same question of the same definition list and a second copy
// would drift the moment a type is added.
//
// Values are held as STRINGS while editing (like the web's forms) and coerced
// to their declared type on save, so a half-typed "-" or "12." is never a
// parse error mid-keystroke.
//
// A date field opens the sheet's own date picker rather than asking the user to
// type an ISO string, which is why `onPickDate` is a callback: the picker is a
// MODE of the host sheet (DESIGN.md — never a second modal), and only the
// host knows how to enter it.
import { StyleSheet, Text, View } from "react-native";
import {
  customFieldDisplayLabel,
  formatDateKey,
  formatFieldValue,
  railStops,
  type AttributeRow,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import { spacing, makeStyles, useTheme, muted } from "../theme";
import {
  Field,
  IconButton,
  Row,
  ChipRail,
  TextField,
  type ChipOption,
  Icon,
} from "../ui";

/**
 * A yes/no answer has THREE states, and "—" is the one a form starts on.
 *
 * A toggle switch has no empty state and would write `false` for every toggle
 * shown, touched or not — leaving an unintended "No" on every trip the
 * attribute was shown on, counted as answered in stats with no way to clear it.
 * The same row of stops a bounded integer draws, for the same reason: unset
 * must stay reachable.
 */
const BOOLEAN_OPTIONS: ChipOption<string>[] = [
  { value: "", label: "—" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

/** Every definition as an input, in the user's own order. */
export function CustomFieldValueInputs({
  defs,
  values,
  onChange,
  onPickDate,
  onRemove,
}: {
  defs: TripLogCustomFieldDef[];
  values: Record<string, string>;
  onChange: (key: string, next: string) => void;
  /** Enter the host sheet's date-picker mode for this field. */
  onPickDate: (key: string) => void;
  /** When given, each input gets a remove button — for fields the form keeps
   *  only because they already hold a value (see `TripEditSheet`). */
  onRemove?: (key: string) => void;
}) {
  return (
    <>
      {defs.map((def) => (
        <CustomFieldValueInput
          key={def.key}
          def={def}
          value={values[def.key] ?? ""}
          onChange={(next) => onChange(def.key, next)}
          onPickDate={() => onPickDate(def.key)}
          trailing={
            onRemove ? (
              <IconButton
                icon="close"
                accessibilityLabel={`Remove ${def.label}`}
                onPress={() => onRemove(def.key)}
              />
            ) : undefined
          }
        />
      ))}
    </>
  );
}

/**
 * Recorded values as a hairline table (rows from `attributeRows`). A table and
 * not cards because a row here is a fact, not something to tap — see "A parked
 * attribute is a CARD; a recorded one is a table row" in mobile/CLAUDE.md.
 */
export function AttributeTable({ rows }: { rows: AttributeRow[] }) {
  const styles = useStyles();

  return (
    <View>
      {rows.map(([key, label, value, type], index) => (
        <View
          key={key}
          style={[
            styles.tableRow,
            index === rows.length - 1 ? styles.tableRowLast : null,
          ]}
        >
          <Text style={styles.tableKey}>{label}</Text>
          <Text style={styles.tableValue}>{formatFieldValue(value, type)}</Text>
        </View>
      ))}
    </View>
  );
}

/** One value input, shaped by the field's declared type. */
function CustomFieldValueInput({
  def,
  value,
  onChange,
  onPickDate,
  trailing,
}: {
  def: TripLogCustomFieldDef;
  value: string;
  onChange: (next: string) => void;
  onPickDate: () => void;
  /** Drawn beside the CONTROL, centred on it — not beside the label above it. */
  trailing?: React.ReactNode;
}) {
  const theme = useTheme();

  const label = customFieldDisplayLabel(def);
  // A BOUNDED INTEGER IS A RAIL. Unset has to stay reachable — most imported
  // places have gaps, and a picker with no way back to blank turns "I don't
  // know" into a wrong answer, which is why the first stop is "—".
  const stops = railStops(def);
  if (stops) {
    const options: ChipOption<string>[] = [{ value: "", label: "—" }];
    for (const stop of stops)
      options.push({ value: String(stop), label: String(stop) });
    return (
      <Field label={def.label}>
        <Beside trailing={trailing}>
          <ChipRail
            scroll
            options={options}
            value={value}
            onChange={onChange}
          />
        </Beside>
      </Field>
    );
  }
  if (def.type === "boolean") {
    return (
      <Field label={label}>
        <Beside trailing={trailing}>
          <ChipRail
            options={BOOLEAN_OPTIONS}
            value={value}
            onChange={onChange}
          />
        </Beside>
      </Field>
    );
  }
  if (def.type === "date") {
    return (
      <Beside trailing={trailing}>
        <Row
          icon="date"
          title={value ? formatDateKey(`${value}T00:00:00.000Z`) : "Not set"}
          subtitle={label}
          right={<Icon idea="disclosure" size={20} color={theme.textMuted} />}
          onPress={onPickDate}
        />
      </Beside>
    );
  }
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={onChange}
      accessory={trailing}
      keyboardType={
        def.type === "integer"
          ? "number-pad"
          : def.type === "float"
            ? "decimal-pad"
            : "default"
      }
      autoCapitalize="sentences"
    />
  );
}

/** A control with an optional button beside it, vertically centred on it. */
function Beside({
  trailing,
  children,
}: {
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  const styles = useStyles();

  if (!trailing) return <>{children}</>;
  return (
    <View style={styles.beside}>
      <View style={styles.besideControl}>{children}</View>
      {trailing}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  beside: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  // `minWidth: 0` lets a scrolling rail shrink beside the button instead of
  // pushing it off the edge.
  besideControl: { flex: 1, minWidth: 0 },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing(2),
    paddingVertical: spacing(1),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
  },
  tableRowLast: { borderBottomWidth: 0 },
  tableKey: { ...muted(theme, textRole.detail), flexShrink: 1 },
  tableValue: {
    ...textRole.control,
    color: theme.text,
    textAlign: "right",
    flexShrink: 1,
  },
}));
