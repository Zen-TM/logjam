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
import type { CustomFieldEntity } from "../api/queries";
import { countFieldValues, removeFieldDef, saveFieldDefs } from "./fieldDefsStore";
import { Button, Row, SectionHeader, SegmentedControl, TextField, Toggle } from "../ui";

/**
 * Manage the user's own custom field definitions — the mobile counterpart of the
 * web's account-level custom fields. One component for BOTH entities a field can
 * hang off (trip logs and canyons); they differ only in the nouns below and in
 * the route the API layer picks.
 *
 * Rendered as MODES of a sheet, never as its own sheet — either the entity's
 * edit form (you reached it from the form you were filling in) or the Settings
 * screen's fields sheet. Two bodies:
 *
 * - `CustomFieldList`: what exists, plus a way in to add or change one.
 * - `CustomFieldForm`: add/rename/retype one, and delete it.
 *
 * Nothing here is gated. Definitions are rows in the local mirror written
 * through the outbox (`fieldDefsStore.ts`), so adding, renaming and deleting a
 * field works with no account and with no signal, for everyone. This file used
 * to carry a `canEdit` flag and a "This needs a connection." hint, because a
 * linked user's definitions then lived on the user record and were shared with
 * the web — a list two surfaces could edit at once with no per-field grain to
 * merge on. The VALUES were always offline-first, and still are.
 *
 * A rename keeps the field's `key`, so stored values stay attached (that is why
 * renaming goes through the same whole-list save as adding). Deleting has its
 * own path because it also strips the orphaned values off every row that
 * carried one — counted up front, before the user confirms.
 */

/** The only per-entity difference in this file: what to call the rows. */
const ENTITY_NOUN: Record<CustomFieldEntity, { one: string; many: string; has: string; have: string }> = {
  tripLog: { one: "trip", many: "trips", has: "trip has", have: "trips have" },
  canyon: { one: "canyon", many: "canyons", has: "canyon has", have: "canyons have" },
};

export function CustomFieldList({
  entity,
  defs,
  onAdd,
  onEdit,
}: {
  entity: CustomFieldEntity;
  defs: TripLogCustomFieldDef[];
  onAdd: () => void;
  onEdit: (def: TripLogCustomFieldDef) => void;
}) {
  const noun = ENTITY_NOUN[entity];
  return (
    <View style={styles.body}>
      {defs.length === 0 ? (
        <Text style={styles.hint}>
          Add your own field to record on every {noun.one} — e.g. water level or party size.
        </Text>
      ) : (
        <>
          <SectionHeader label={`${defs.length} field${defs.length === 1 ? "" : "s"}`} />
          {defs.map((def) => (
            <Row
              key={def.key}
              icon="tag"
              title={customFieldDisplayLabel(def)}
              subtitle={fieldSummary(def)}
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
  entity,
  defs,
  editing,
  onSaved,
  onFailed,
  onDone,
}: {
  entity: CustomFieldEntity;
  defs: TripLogCustomFieldDef[];
  /** null = adding a new field. */
  editing: TripLogCustomFieldDef | null;
  onSaved: (defs: TripLogCustomFieldDef[], message: string) => void;
  onFailed: (message: string) => void;
  onDone: () => void;
}) {
  const noun = ENTITY_NOUN[entity];
  const [label, setLabel] = useState(editing?.label ?? "");
  const [type, setType] = useState<TripLogCustomFieldType>(editing?.type ?? "string");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bounded, setBounded] = useState(editing?.min != null);
  const [min, setMin] = useState(editing?.min != null ? String(editing.min) : "");
  const [max, setMax] = useState(editing?.max != null ? String(editing.max) : "");
  // Bounds are only meaningful on a number, and the API rejects them elsewhere.
  const numeric = type === "integer" || type === "float";

  const save = useCallback(async () => {
    setError(null);
    // Same builder the web uses, so the key slug and the validation rules can't
    // drift between clients.
    const built = buildCustomFieldDef(
      { label, type, bounded: numeric && bounded, min, max },
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
      await saveFieldDefs(entity, next);
      onSaved(next, editing ? "Field updated." : "Field added.");
      onDone();
    } catch (err) {
      console.error(err);
      // A local write, so a failure here is a broken database rather than a
      // missing connection — do not offer the user a network explanation for
      // something reconnecting cannot fix.
      onFailed("Couldn't save that field on this phone.");
    } finally {
      setSaving(false);
    }
  }, [bounded, defs, editing, entity, label, max, min, numeric, onDone, onFailed, onSaved, type]);

  const confirmDelete = useCallback(() => {
    if (!editing) return;
    const key = editing.key;
    // Count the rows that carry a value BEFORE confirming: "this also clears it
    // from 12 trips" is the part of the consequence the user can't see.
    countFieldValues(entity, key)
      .then((affected) => {
        Alert.alert(
          `Delete “${editing.label}”?`,
          affected === 0
            ? `No ${noun.many} use this field yet. This can't be undone.`
            : `This clears the value from ${affected} ${affected === 1 ? noun.one : noun.many}. This can't be undone.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => {
                removeFieldDef(entity, key)
                  .then((removed) => {
                    onSaved(
                      defs.filter((def) => def.key !== key),
                      removed === 0
                        ? "Field deleted."
                        : `Field deleted. Cleared from ${removed} ${removed === 1 ? noun.one : noun.many}.`,
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
        onFailed(`Couldn't check which ${noun.many} use this field.`);
      });
  }, [defs, editing, entity, noun, onDone, onFailed, onSaved]);

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
            Existing values are kept.
          </Text>
        ) : null}
      </View>

      {/* Range is offered only for numbers, because that is the only place it
          means anything — and it is what makes the web's range slider work. */}
      {numeric ? (
        <View style={styles.typeBlock}>
          <Row
            icon="sliders"
            title="Limit to a range"
            subtitle={bounded ? "Values must be between the min and max you set" : "Any number"}
            right={
              <Toggle
                value={bounded}
                onValueChange={setBounded}
                accessibilityLabel="Limit to a range"
              />
            }
          />
          {bounded ? (
            <View style={styles.boundsRow}>
              <View style={styles.bound}>
                <TextField
                  label="Min"
                  value={min}
                  onChangeText={setMin}
                  keyboardType={type === "integer" ? "number-pad" : "decimal-pad"}
                />
              </View>
              <View style={styles.bound}>
                <TextField
                  label="Max"
                  value={max}
                  onChangeText={setMax}
                  keyboardType={type === "integer" ? "number-pad" : "decimal-pad"}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
      <Button
        label={editing ? "Save field" : "Add field"}
        icon="check"
        loading={saving}
        onPress={() => void save()}
      />
      {editing ? (
        <Row
          icon="trash-2"
          hue={theme.warning}
          title="Delete field"
          onPress={confirmDelete}
        />
      ) : null}
    </View>
  );
}

function fieldSummary(def: TripLogCustomFieldDef): string {
  const base = typeLabel(def.type);
  return def.min != null && def.max != null ? `${base} · ${def.min}–${def.max}` : base;
}

function typeLabel(type: TripLogCustomFieldType): string {
  return CUSTOM_FIELD_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  typeBlock: { gap: spacing(0.5) },
  hint: { color: theme.textMuted, fontSize: fontSize.sm },
  boundsRow: { flexDirection: "row", gap: spacing(1) },
  bound: { flex: 1 },
});
