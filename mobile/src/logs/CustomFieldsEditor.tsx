import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  buildCustomFieldDef,
  CUSTOM_FIELD_TYPES,
  customFieldDisplayLabel,
  type TripLogCustomFieldDef,
  type TripLogCustomFieldType,
} from "@logjam/shared";

import { fontSize, spacing, theme } from "../theme";
import {
  deleteTripLogCustomField,
  getCustomFieldImpact,
  updateTripLogCustomFields,
} from "../api/queries";
import { Button, Row, SectionHeader, SegmentedControl, TextField } from "../ui";

/**
 * Manage the user's own trip-log field definitions — the mobile counterpart of
 * the web's account-level custom fields.
 *
 * Rendered as MODES of the trip editor's sheet (never its own sheet), because
 * you reach it from the form you were filling in. Two bodies:
 *
 * - `CustomFieldList`: what exists, plus a way in to add or change one.
 * - `CustomFieldForm`: add/rename/retype one, and delete it.
 *
 * Definitions live in `User.uiPreferences`, which every device and the web
 * share, so this is deliberately ONLINE-ONLY: a queued offline edit to a shared
 * list would need merge rules for a list the user could be reordering in a
 * browser at the same time. Trip VALUES stay offline-first as always.
 *
 * A rename keeps the field's `key`, so stored values stay attached (that is why
 * renaming goes through the same PATCH as adding). Deleting is a separate
 * endpoint because it also strips the orphaned values off every trip that
 * carried one — reported up front, before the user confirms.
 */
export function CustomFieldList({
  defs,
  onAdd,
  onEdit,
}: {
  defs: TripLogCustomFieldDef[];
  onAdd: () => void;
  onEdit: (def: TripLogCustomFieldDef) => void;
}) {
  return (
    <View style={styles.body}>
      {defs.length === 0 ? (
        <Text style={styles.hint}>
          Your own fields go here — water level, party size, car shuttle, whatever
          you want to record on every trip.
        </Text>
      ) : (
        <>
          <SectionHeader label={`${defs.length} field${defs.length === 1 ? "" : "s"}`} />
          {defs.map((def) => (
            <Row
              key={def.key}
              icon="tag"
              title={customFieldDisplayLabel(def)}
              subtitle={typeLabel(def.type)}
              onPress={() => onEdit(def)}
            />
          ))}
        </>
      )}
      <Row icon="plus" title="Add a field" onPress={onAdd} />
    </View>
  );
}

export function CustomFieldForm({
  defs,
  editing,
  onSaved,
  onFailed,
  onDone,
}: {
  defs: TripLogCustomFieldDef[];
  /** null = adding a new field. */
  editing: TripLogCustomFieldDef | null;
  onSaved: (defs: TripLogCustomFieldDef[], message: string) => void;
  onFailed: (message: string) => void;
  onDone: () => void;
}) {
  const [label, setLabel] = useState(editing?.label ?? "");
  const [type, setType] = useState<TripLogCustomFieldType>(editing?.type ?? "string");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    setError(null);
    // Same builder the web uses, so the key slug and the validation rules can't
    // drift between clients.
    // `bounded: false` — min/max bounds are a web-only nicety (they drive a
    // range slider in the canyon filter); a field created there keeps its
    // bounds, this just doesn't offer them.
    const built = buildCustomFieldDef(
      { label, type, bounded: false, min: "", max: "" },
      defs.filter((def) => def.key !== editing?.key),
    );
    if ("error" in built) {
      setError(built.error);
      return;
    }
    // A rename keeps the original key so the values already stored on trips stay
    // attached to it.
    const next = editing
      ? defs.map((def) =>
          def.key === editing.key ? { ...built.def, key: editing.key } : def,
        )
      : [...defs, built.def];
    setSaving(true);
    try {
      await updateTripLogCustomFields(next);
      onSaved(next, editing ? "Field updated." : "Field added.");
      onDone();
    } catch (err) {
      console.error(err);
      onFailed("Couldn't save that field. Custom fields need a connection.");
    } finally {
      setSaving(false);
    }
  }, [defs, editing, label, onDone, onFailed, onSaved, type]);

  const confirmDelete = useCallback(() => {
    if (!editing) return;
    const key = editing.key;
    // Ask the server how many trips carry a value BEFORE confirming: "this also
    // clears it from 12 trips" is the part of the consequence the user can't see.
    getCustomFieldImpact(key)
      .then(({ tripLogCount }) => {
        Alert.alert(
          `Delete “${editing.label}”?`,
          tripLogCount === 0
            ? "No trips use this field yet. This can't be undone."
            : `${tripLogCount} ${tripLogCount === 1 ? "trip has" : "trips have"} a value for this field, and it will be cleared from ${tripLogCount === 1 ? "it" : "them"} too. This can't be undone.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => {
                deleteTripLogCustomField(key)
                  .then(({ removedFromTripCount }) => {
                    onSaved(
                      defs.filter((def) => def.key !== key),
                      removedFromTripCount === 0
                        ? "Field deleted."
                        : `Field deleted, and cleared from ${removedFromTripCount} ${removedFromTripCount === 1 ? "trip" : "trips"}.`,
                    );
                    onDone();
                  })
                  .catch((err: unknown) => {
                    console.error(err);
                    onFailed("Couldn't delete that field.");
                  });
              },
            },
          ],
        );
      })
      .catch((err: unknown) => {
        console.error(err);
        onFailed("Couldn't check which trips use this field.");
      });
  }, [defs, editing, onDone, onFailed, onSaved]);

  return (
    <View style={styles.body}>
      <TextField
        label="Field name"
        value={label}
        onChangeText={setLabel}
        error={error}
        autoCapitalize="sentences"
      />
      <View style={styles.typeBlock}>
        <SectionHeader label="Type" />
        <SegmentedControl
          options={CUSTOM_FIELD_TYPES.map((entry) => ({
            value: entry.value,
            label: entry.label,
          }))}
          value={type}
          onChange={setType}
        />
        {editing ? (
          <Text style={styles.hint}>
            Changing the type leaves values already recorded as they are.
          </Text>
        ) : null}
      </View>
      <Button
        label={editing ? "Save field" : "Add field"}
        icon="check"
        loading={saving}
        onPress={() => void save()}
      />
      {editing ? (
        <Row icon="trash-2" hue={theme.warning} title="Delete field" onPress={confirmDelete} />
      ) : null}
    </View>
  );
}

function typeLabel(type: TripLogCustomFieldType): string {
  return CUSTOM_FIELD_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  typeBlock: { gap: spacing(0.5) },
  hint: { color: theme.textMuted, fontSize: fontSize.sm },
});
