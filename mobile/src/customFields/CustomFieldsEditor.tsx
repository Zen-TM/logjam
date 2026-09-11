import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  buildCustomFieldDef,
  CUSTOM_FIELD_TYPES,
  isSystemFieldDef,
  type ScopedCustomFieldDef,
  type TripLogCustomFieldType,
} from "@logjam/shared";

import { fontSize, spacing, theme } from "../theme";
import type { CustomFieldEntity } from "../api/queries";
import { countFieldValues, removeFieldDef, saveFieldDefs } from "./fieldDefsStore";
import { useMirrorPlaceTypes } from "../sync/useSyncQueries";
import {
  Button,
  ChipPicker,
  Row,
  SectionHeader,
  SegmentedControl,
  TextField,
  Toggle,
} from "../ui";

/**
 * Manage the user's own custom field definitions — the mobile counterpart of the
 * web's account-level custom fields. One component for BOTH entities a field can
 * hang off (trip logs and places); they differ only in the nouns below and in
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
  place: { one: "place", many: "places", has: "place has", have: "places have" },
};

/**
 * What a user's own field is CALLED, everywhere the user can read it.
 *
 * "Field" is form jargon — it names the box, not the thing the box records — so
 * the UI says "attribute" and the code keeps saying field (the column, the
 * table, the sync entity and every function in this file). One constant rather
 * than forty string literals, so the next rename is one line and cannot leave
 * half the app behind.
 */
export const ATTRIBUTE_NOUN = {
  one: "attribute",
  many: "attributes",
  /** Carried rather than composed: "a"/"an" does not follow from the noun, and
   *  a rename that leaves "a attribute" behind is the classic way this kind of
   *  constant half-works. */
  add: "Add an attribute",
} as const;

export function CustomFieldList({
  entity,
  defs,
  onEdit,
}: {
  entity: CustomFieldEntity;
  defs: ScopedCustomFieldDef[];
  onEdit: (def: ScopedCustomFieldDef) => void;
}) {
  const noun = ENTITY_NOUN[entity];
  // BUILT-INS LAST. The list is two things stacked: what the user made, and
  // what the app ships. Theirs is the half they came here to change, so it
  // reads first — and the built-ins, which carry no verbs at all, stop
  // interrupting it. `position` (the order they arranged) still decides within
  // each half, which is why this is a stable partition and not a sort key.
  const ordered = [
    ...defs.filter((def) => !isSystemFieldDef(def)),
    ...defs.filter(isSystemFieldDef),
  ];
  return (
    <View style={styles.body}>
      {ordered.length === 0 ? (
        <Text style={styles.hint}>
          Add your own {ATTRIBUTE_NOUN.one} to record on every {noun.one} — e.g. water
          level or party size.
        </Text>
      ) : (
        <>
          <SectionHeader
            label={`${ordered.length} ${ordered.length === 1 ? ATTRIBUTE_NOUN.one : ATTRIBUTE_NOUN.many}`}
          />
          {ordered.map((def) =>
            // A BUILT-IN gets no verbs, the same way a system place type does:
            // it belongs to no account, the server refuses a rename and a
            // delete, and the phone's half of a delete (strip the value off
            // every place carrying the key) would run first and for real.
            // A row with no action reads as a fact; a row that fails reads as
            // a bug.
            isSystemFieldDef(def) ? (
              <Row
                key={defRowKey(def)}
                icon="lock"
                // The BARE label, not `customFieldDisplayLabel`: that appends
                // the range, and the subtitle one line down already says
                // "Integer · 1–7". Printing the bounds twice on one row made
                // the list read as a form rather than an inventory.
                title={def.label}
                subtitle={`Built in · ${fieldSummary(def)}`}
              />
            ) : (
              <Row
                key={defRowKey(def)}
                icon="tag"
                title={def.label}
                subtitle={fieldSummary(def)}
                onPress={() => onEdit(def)}
              />
            ),
          )}
        </>
      )}
    </View>
  );
}

/**
 * Add, rename, retype or delete one definition — as a BODY and a FOOTER the
 * host places separately.
 *
 * A hook rather than a component because the two actions have to be PINNED:
 * DESIGN.md's rule is that a sheet's primary action never scrolls away, and
 * this form (name, type, bounds, and a chip per place type) comfortably
 * outgrows the 80% cap on a phone with a keyboard up. Returning two nodes lets
 * the host put one in `children` and one in `footer` without either of them
 * needing to know about the other.
 */
export function useCustomFieldForm({
  entity,
  defs,
  editing,
  initialTypeId,
  onSaved,
  onFailed,
  onDone,
}: {
  entity: CustomFieldEntity;
  defs: ScopedCustomFieldDef[];
  /** null = adding a new field. */
  editing: ScopedCustomFieldDef | null;
  /**
   * The place type whose form this was opened from — PRE-SELECTED in the scope
   * picker, not substituted for it. It used to remove the picker entirely on
   * the grounds that the user had already answered the question by being on a
   * canyon; what that actually did was make the form reached from a place a
   * lesser one than the identical form in Settings, with no way to say "and on
   * campsites too" short of going somewhere else and editing it again. The
   * default answers the question; the picker keeps it changeable.
   */
  initialTypeId?: string;
  onSaved: (defs: ScopedCustomFieldDef[], message: string) => void;
  onFailed: (message: string) => void;
  onDone: () => void;
}): { body: ReactNode; footer: ReactNode } {
  const noun = ENTITY_NOUN[entity];
  const placeTypes = useMirrorPlaceTypes();
  // Only a PLACE field has anywhere to choose between — a trip log has no types.
  const scoping = entity === "place";
  const allTypeIds = (placeTypes.data ?? []).map((placeType) => placeType.id);

  // ONE draft object, because the whole of it has to be re-seeded when the host
  // switches which definition is being edited. This is a hook, so unlike the
  // component it replaced it is not unmounted between opens — nine separate
  // `useState` initialisers would each keep the PREVIOUS field's value, and the
  // user would open "Water level" and find "Gate code" in the box.
  const formKey = editing?.key ?? "__new__";
  const [draft, setDraft] = useState<FieldDraft>(() => seedDraft(editing, initialTypeId));
  const [seededFor, setSeededFor] = useState(formKey);
  if (seededFor !== formKey) {
    // React's documented way to adjust state when a prop changes: assign during
    // render, no effect, no flash of the old field's name.
    setSeededFor(formKey);
    setDraft(seedDraft(editing, initialTypeId));
  }
  const { label, type, bounded, min, max, appliesToAll, typeIds } = draft;
  const patch = (change: Partial<FieldDraft>) =>
    setDraft((current) => ({ ...current, ...change }));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  // Bounds are only meaningful on a number, and the API rejects them elsewhere.
  const numeric = type === "integer" || type === "float";

  const save = useCallback(async () => {
    setError(null);
    setScopeError(null);
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
    // A place field that is on no type and not on all of them appears on NO
    // form — it exists in Settings and nowhere else, which reads as the save
    // having failed. Refused here rather than saved and puzzled over, and
    // reported UNDER THE CHIPS: as the name field's error it sat beside the one
    // control that was not the problem.
    if (scoping && !appliesToAll && typeIds.length === 0) {
      setScopeError(`Pick at least one place type, or “All”.`);
      return;
    }
    const scope =
      entity === "place"
        ? { appliesToAllTypes: appliesToAll, placeTypeIds: appliesToAll ? [] : typeIds }
        : // A trip-log field has no types to be scoped to; it is on every trip.
          { appliesToAllTypes: true, placeTypeIds: [] };
    // A rename keeps the original key so the values already stored on trips stay
    // attached to it.
    const next: ScopedCustomFieldDef[] = editing
      ? defs.map((def) =>
          def.key === editing.key
            ? { ...built.def, key: editing.key, ...scope }
            : def,
        )
      : [...defs, { ...built.def, ...scope }];
    setSaving(true);
    try {
      await saveFieldDefs(entity, next);
      onSaved(
        next,
        editing
          ? `${capitalize(ATTRIBUTE_NOUN.one)} updated.`
          : `${capitalize(ATTRIBUTE_NOUN.one)} added.`,
      );
      onDone();
    } catch (err) {
      console.error(err);
      // A local write, so a failure here is a broken database rather than a
      // missing connection — do not offer the user a network explanation for
      // something reconnecting cannot fix.
      onFailed(`Couldn't save that ${ATTRIBUTE_NOUN.one} on this phone.`);
    } finally {
      setSaving(false);
    }
  }, [
    appliesToAll,
    bounded,
    defs,
    editing,
    entity,
    label,
    max,
    min,
    numeric,
    onDone,
    onFailed,
    onSaved,
    scoping,
    type,
    typeIds,
  ]);

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
            ? `No ${noun.many} use this ${ATTRIBUTE_NOUN.one} yet. This can't be undone.`
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
                        ? `${capitalize(ATTRIBUTE_NOUN.one)} deleted.`
                        : `${capitalize(ATTRIBUTE_NOUN.one)} deleted. Cleared from ${removed} ${removed === 1 ? noun.one : noun.many}.`,
                    );
                    onDone();
                  })
                  .catch((err: unknown) => {
                    console.error(err);
                    onFailed(`Couldn't delete that ${ATTRIBUTE_NOUN.one}.`);
                  });
              },
            },
          ],
        );
      })
      .catch((err: unknown) => {
        console.error(err);
        onFailed(`Couldn't check which ${noun.many} use this ${ATTRIBUTE_NOUN.one}.`);
      });
  }, [defs, editing, entity, noun, onDone, onFailed, onSaved]);

  const body = (
    <View style={styles.body}>
      <TextField
        label={`${capitalize(ATTRIBUTE_NOUN.one)} name`}
        value={label}
        onChangeText={(next) => patch({ label: next })}
        error={error}
        autoCapitalize="sentences"
      />

      {/* WHAT IT HOLDS. The range belongs to this section and not to its own:
          a min and a max are properties of a NUMBER, and standing them apart
          under a heading of their own put them next to the place-type picker,
          which is the other thing on this screen called a "type". */}
      <View style={styles.typeBlock}>
        <SectionHeader label={`What it holds`} />
        <SegmentedControl
          options={CUSTOM_FIELD_TYPES.map((entry) => ({
            value: entry.value,
            label: entry.label,
          }))}
          value={type}
          onChange={(next) => patch({ type: next })}
        />
        {editing ? <Text style={styles.hint}>Existing values are kept.</Text> : null}
        {/* Range is offered only for numbers, because that is the only place it
            means anything — and it is what makes the web's range slider work,
            and the phone's stop rail. */}
        {numeric ? (
          <>
            <Row
              icon="sliders"
              title="Limit to a range"
              subtitle={
                bounded ? "Values must be between the min and max you set" : "Any number"
              }
              right={
                <Toggle
                  value={bounded}
                  onValueChange={(next) => patch({ bounded: next })}
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
                    onChangeText={(next) => patch({ min: next })}
                    keyboardType={type === "integer" ? "number-pad" : "decimal-pad"}
                  />
                </View>
                <View style={styles.bound}>
                  <TextField
                    label="Max"
                    value={max}
                    onChangeText={(next) => patch({ max: next })}
                    keyboardType={type === "integer" ? "number-pad" : "decimal-pad"}
                  />
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {/* WHERE IT APPEARS. "All" is a chip in the same row rather than a toggle
          above it: it is one more answer to the one question this control asks,
          and a toggle that hid the chips made "all of them" look like a
          different kind of decision from "these three".

          It stays a FLAG on the way out, never every box ticked — a field
          scoped by ticking each type that exists today would silently fail to
          apply to one created tomorrow, and the user who meant "all" would
          never find out. Which is exactly why the other chips go LOCKED rather
          than merely selected while it is on: they are not a list this field
          carries, they are what "all" currently happens to mean. */}
      {scoping ? (
        <View style={styles.typeBlock}>
          <ChipPicker
            label="Place types"
            options={[
              { value: ALL_TYPES_CHIP, label: "All" },
              ...(placeTypes.data ?? []).map((placeType) => ({
                value: placeType.id,
                label: placeType.name,
              })),
            ]}
            selected={appliesToAll ? [ALL_TYPES_CHIP, ...allTypeIds] : typeIds}
            disabledValues={appliesToAll ? new Set(allTypeIds) : undefined}
            onToggle={(value) => {
              if (value === ALL_TYPES_CHIP) {
                patch({ appliesToAll: !appliesToAll });
                return;
              }
              patch({
                typeIds: typeIds.includes(value)
                  ? typeIds.filter((existing) => existing !== value)
                  : [...typeIds, value],
              });
            }}
          />
          {scopeError ? <Text style={styles.scopeError}>{scopeError}</Text> : null}
        </View>
      ) : null}

      {editing ? (
        <Row
          icon="trash-2"
          hue={theme.warning}
          title={`Delete ${ATTRIBUTE_NOUN.one}`}
          onPress={confirmDelete}
        />
      ) : null}
    </View>
  );

  // Cancel LEFT, commit RIGHT, half the width each: the destination of a tap
  // should not depend on how long the label happens to be.
  const footer = (
    <View style={styles.actions}>
      <View style={styles.action}>
        <Button label="Cancel" variant="outlineAccent" onPress={onDone} />
      </View>
      <View style={styles.action}>
        <Button
          label={editing ? "Save" : `Add ${ATTRIBUTE_NOUN.one}`}
          icon="check"
          loading={saving}
          onPress={() => void save()}
        />
      </View>
    </View>
  );

  return { body, footer };
}

/** The "all place types" chip's value. Not a type id, and it cannot collide
 *  with one: every real id is a UUID. */
const ALL_TYPES_CHIP = "__all__";

/** Everything the form holds while it is being filled in. */
type FieldDraft = {
  label: string;
  type: TripLogCustomFieldType;
  bounded: boolean;
  min: string;
  max: string;
  appliesToAll: boolean;
  typeIds: string[];
};

/**
 * A list key that cannot collide.
 *
 * The obvious `def.key` is unique per OWNER, not per list, and this list holds
 * the user's own definitions beside the built-ins. Nothing normally lets those
 * two spaces meet — `assertKeyNotReserved` refuses a reserved key on create and
 * rename — but adding a system definition makes a key reserved AFTER the fact,
 * so anyone who already had that key holds a legal duplicate until the
 * migration renames theirs. React answered that by rendering one row and
 * dropping the other, which is a worse failure than showing both.
 */
function defRowKey(def: ScopedCustomFieldDef): string {
  return `${def.ownerId ?? "system"}:${def.key}`;
}

/** The draft a given definition opens with. A NEW field opened from a place's
 *  own form starts scoped to that type — the user asked for it while filling in
 *  a canyon — and from Settings starts on all of them, where the answer is
 *  genuinely theirs to make. */
function seedDraft(
  editing: ScopedCustomFieldDef | null,
  initialTypeId: string | undefined,
): FieldDraft {
  return {
    label: editing?.label ?? "",
    type: editing?.type ?? "string",
    bounded: editing?.min != null,
    min: editing?.min != null ? String(editing.min) : "",
    max: editing?.max != null ? String(editing.max) : "",
    appliesToAll: editing ? editing.appliesToAllTypes : initialTypeId == null,
    typeIds: editing
      ? editing.placeTypeIds
      : initialTypeId != null
        ? [initialTypeId]
        : [],
  };
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function fieldSummary(def: ScopedCustomFieldDef): string {
  const base = typeLabel(def.type);
  // ONE-SIDED BOUNDS COUNT. Requiring both printed a bare "Integer" for a
  // min-only field whose own title says "(0+)" — the same both-or-neither
  // assumption that has been fixed twice already, in the row reader and on the
  // push path.
  if (def.min != null && def.max != null) return `${base} · ${def.min}–${def.max}`;
  if (def.min != null) return `${base} · ${def.min}+`;
  if (def.max != null) return `${base} · up to ${def.max}`;
  return base;
}

function typeLabel(type: TripLogCustomFieldType): string {
  return CUSTOM_FIELD_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  actions: { flexDirection: "row", gap: spacing(1) },
  action: { flex: 1 },
  scopeError: { color: theme.warning, fontSize: fontSize.sm },
  typeBlock: { gap: spacing(0.5) },
  hint: { color: theme.textMuted, fontSize: fontSize.sm },
  boundsRow: { flexDirection: "row", gap: spacing(1) },
  bound: { flex: 1 },
});
