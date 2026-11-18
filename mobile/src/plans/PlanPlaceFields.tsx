// A plan place's details as its forms ask them: other names, position,
// elevation, notes and the attributes of its system type. Drawn by the edit
// sheet (which compares against the plan) and the new place sheet; both own
// the date picker's sub-mode (`PlanDateEditor`).
import { View } from "react-native";
import {
  coordinateEntry,
  ITEM_ATTR,
  TRIP_PLAN_PAGE,
  type ItemWords,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import { CustomFieldValueInputs } from "../customFields/CustomFieldValues";
import { makeStyles, spacing } from "../theme";
import { Button, DatePicker, FormStack, SectionHeader, TextField } from "../ui";

const copy = TRIP_PLAN_PAGE.copy;

export function PlanPlaceFields({
  values,
  defs,
  set,
  onPickDate,
  theirs = () => undefined,
}: {
  values: ItemWords;
  defs: TripLogCustomFieldDef[];
  set: (next: Record<string, string>) => void;
  /** Enter the sheet's date-picker mode for this attribute. */
  onPickDate: (key: string) => void;
  /** The plan's words under a field someone else changed, if any. */
  theirs?: (field: string) => string | undefined;
}) {
  const styles = useStyles();
  return (
    <>
      <TextField
        label={copy.itemAlsoKnownAs}
        value={values.altNames}
        hint={theirs("altNames") ?? copy.itemAlsoKnownAsHint}
        autoCapitalize="words"
        onChangeText={(altNames) => set({ altNames })}
      />
      <View style={styles.coordRow}>
        <View style={styles.coordField}>
          <TextField
            label={copy.itemLatitude}
            value={values.latitude}
            hint={theirs("latitude")}
            keyboardType="numbers-and-punctuation"
            onChangeText={(next) =>
              set(coordinateEntry(next, "latitude", values.latitude))
            }
          />
        </View>
        <View style={styles.coordField}>
          <TextField
            label={copy.itemLongitude}
            value={values.longitude}
            hint={theirs("longitude")}
            keyboardType="numbers-and-punctuation"
            onChangeText={(next) =>
              set(coordinateEntry(next, "longitude", values.longitude))
            }
          />
        </View>
      </View>
      <TextField
        label={copy.itemElevation}
        value={values.elevation}
        hint={theirs("elevation")}
        keyboardType="numbers-and-punctuation"
        onChangeText={(elevation) => set({ elevation })}
      />
      <TextField
        label={copy.itemNotes}
        value={values.notes}
        hint={theirs("notes")}
        multiline
        autoCapitalize="sentences"
        onChangeText={(notes) => set({ notes })}
      />
      {defs.length > 0 ? (
        <>
          <SectionHeader title={copy.itemAttributes} />
          <CustomFieldValueInputs
            defs={defs}
            values={Object.fromEntries(
              defs.map((def) => [def.key, values[ITEM_ATTR + def.key] ?? ""]),
            )}
            onChange={(key, next) => set({ [ITEM_ATTR + key]: next })}
            onPickDate={onPickDate}
          />
        </>
      ) : null}
    </>
  );
}

/** The date picker standing in for a sheet's form while an attribute's date is
 *  chosen. */
export function PlanDateEditor({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (day: string) => void;
  /** The date taken away; the sheet goes back to its form. */
  onClear: () => void;
}) {
  return (
    <FormStack>
      <DatePicker value={value || null} onChange={onChange} />
      {/* An attribute date may be unknown: a picker with no way back to
          blank turns that into a wrong answer. */}
      {value ? (
        <Button
          label="Clear date"
          icon="close"
          variant="ghost"
          onPress={onClear}
        />
      ) : null}
    </FormStack>
  );
}

const useStyles = makeStyles(() => ({
  coordRow: { flexDirection: "row", gap: spacing(1) },
  coordField: { flex: 1 },
}));
