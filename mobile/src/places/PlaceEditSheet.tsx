import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  defsForType,
  setFieldValues as withFieldValues,
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPE_IDS,
  userFieldValues,
  validatePlacePayload,
  type ScopedCustomFieldDef,
} from "@logjam/shared";

import { fontSize, spacing, theme } from "../theme";
import type { MirrorPlace } from "../sync/mirrorStore";
import { createPlaceLocal, updatePlaceLocal } from "../sync/outbox";
import {
  ATTRIBUTE_NOUN,
  CustomFieldList,
  useCustomFieldForm,
} from "../customFields/CustomFieldsEditor";
import { CustomFieldValueInputs } from "../customFields/CustomFieldValues";
import {
  coerceCustomFields,
  fieldValueStrings,
  sameFieldValues,
  withoutClearedFields,
} from "../customFields/fieldValueCoercion";
import { useFieldDefs } from "../customFields/useFieldDefs";
import { useMirrorPlaceTypes } from "../sync/useSyncQueries";
import { placeTypeFeatherIcon } from "./placeTypeIcon";
import {
  BottomSheet,
  Button,
  DatePicker,
  ErrorBanner,
  Row,
  SectionHeader,
  SegmentedControl,
  TextField,
  type SegmentOption,
} from "../ui";

/**
 * Add or edit a place — one sheet for both (DESIGN.md §7). The fields are
 * identical; only the title, the submit label and whether coordinates arrive
 * pre-filled differ.
 *
 * Both paths queue through the outbox, so adding a place standing at its
 * entrance with no signal works exactly like adding one at home.
 *
 * Coordinates are typed, or seeded by the caller from a point pressed on the map
 * (`initialCoords`). They are never captured from GPS *here*: a permission window
 * cannot be raised from an open sheet (DESIGN.md §7 — the bug that made "Take
 * photo" look dead), so any future fix-based entry belongs in the caller too.
 *
 * The user's own fields are edited here too, and their definitions are reached
 * through a MODE of this sheet, exactly as on `TripEditSheet` (DESIGN.md §6 —
 * never a second modal). A date-typed field needs the picker, which is the
 * other mode.
 *
 * PRIVACY: a place's name and position are the most sensitive pair in the app.
 * They live in component state and leave only through the outbox's authed push;
 * nothing here is logged, and the failure copy is ours rather than the error's.
 */
/** The sheet's sub-screens. Modes, never a second sheet (DESIGN.md §6). */
type Mode = "form" | "date" | "fields" | "fieldForm";

export function PlaceEditSheet({
  visible,
  onClose,
  place,
  initialCoords,
  onPickOnMap,
  pickedCoords,
  resuming = false,
  onSaved,
  onFailed,
}: {
  visible: boolean;
  onClose: () => void;
  /** null/undefined = add a new place. */
  place?: MirrorPlace | null;
  /** Seeds a new place's position from a point picked on the map. */
  initialCoords?: { latitude: number; longitude: number } | null;
  /**
   * Open the full-screen map picker, carrying whatever is in the two coordinate
   * fields right now so it can open there. Absent where there is nowhere to
   * navigate to — this sheet is also mounted on the map itself and on a
   * place's detail screen, and only the Places list owns the picker route.
   */
  onPickOnMap?: (current: { latitude: number; longitude: number } | null) => void;
  /** A point the picker returned: writes the two fields and nothing else. */
  pickedCoords?: { latitude: number; longitude: number } | null;
  /**
   * True when this sheet is being re-opened after the picker took the screen,
   * rather than opened for a new edit.
   *
   * A sheet is a Modal, so it HAS to close for a full-screen map to be visible
   * — and re-opening otherwise reseeds every field from the place, which would
   * throw away the name and grades the user typed before going to look up where
   * the thing is. The component stays mounted throughout, so its state is
   * intact; this flag is only what stops the seed effect from wiping it.
   */
  resuming?: boolean;
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
}) {
  const editing = place != null;
  const [name, setName] = useState("");
  const [altNames, setAltNames] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [notes, setNotes] = useState("");
  const [placeTypeId, setPlaceTypeId] = useState<string>(SYSTEM_PLACE_TYPE_IDS.canyon);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>("form");
  const { defs: customFieldDefs, setDefs: setCustomFieldDefs } = useFieldDefs("place");
  const placeTypes = useMirrorPlaceTypes();
  // Values are strings while editing and coerced on save, like every other
  // custom-field form.
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [dateFieldKey, setDateFieldKey] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<ScopedCustomFieldDef | null>(null);

  // Read through a ref so it is NOT a dependency: `resuming` and `visible` flip
  // in the same commit, and listing it would re-run the seed the moment the
  // parent cleared the flag afterwards — which is the wipe this exists to stop.
  const resumingRef = useRef(resuming);
  resumingRef.current = resuming;

  // Seed each time the sheet opens, so a cancelled edit never leaks into the
  // next one.
  useEffect(() => {
    if (!visible || resumingRef.current) return;
    setInvalid(null);
    setSaving(false);
    setName(place?.name ?? "");
    setAltNames((place?.altNames ?? []).join(", "));
    // An existing place's stored value is shown exactly; a freshly picked point
    // is trimmed, because a map press carries fifteen meaningless decimals.
    setLatitude(place ? numberText(place.latitude) : seedCoord(initialCoords?.latitude));
    setLongitude(place ? numberText(place.longitude) : seedCoord(initialCoords?.longitude));
    // The grades are ordinary field values, seeded by the one path every other
    // field uses — there is no second reader for them any more.
    setNotes(place?.notes ?? "");
    // A new place starts as a CANYON: this is a canyoning app, and a default
    // that is right most of the time beats a picker with nothing chosen. The
    // rail is right there to say otherwise.
    setPlaceTypeId(place?.placeTypeId ?? SYSTEM_PLACE_TYPE_IDS.canyon);
    setMode("form");
    setEditingField(null);
    setDateFieldKey(null);
    setFieldValues(fieldValueStrings(userFieldValues(place?.fieldValues)));
    // Keyed on the place's ID, not the object: a detail screen hands this a
    // fresh object on every mirror change (a sync pull, an upload tick), and
    // re-seeding on that wiped whatever the user was halfway through typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.id, initialCoords, visible]);

  // A point back from the picker touches the two coordinate fields and nothing
  // else — everything else on this form is what the user was in the middle of
  // typing. Trimmed like any freshly picked point: a map tap carries fifteen
  // meaningless decimals.
  useEffect(() => {
    if (!pickedCoords) return;
    setLatitude(seedCoord(pickedCoords.latitude));
    setLongitude(seedCoord(pickedCoords.longitude));
  }, [pickedCoords]);

  /** Every type is offered here, including the empty ones — the list hides a
   *  type with no places, but you have to be able to make the first one. */
  const typeOptions: SegmentOption<string>[] = useMemo(
    () =>
      (placeTypes.data ?? []).map((type) => ({
        value: type.id,
        label: type.name,
        icon: placeTypeFeatherIcon(type.iconKey),
        hue: type.color,
      })),
    [placeTypes.data],
  );

  /**
   * The fields THIS type's form asks for — ALL of them, with nothing cut.
   *
   * The seven canyon axes used to be seven hand-written controls above this
   * list, with their keys spelled out, and were then subtracted from it so they
   * were not asked twice. They are ordinary bounded field values with ordinary
   * definitions, so the generic renderer draws them now: a bounded integer is a
   * rail (`CustomFieldValues.tsx`), which is the same control by a rule instead
   * of by name. Three consequences, all wanted — a canyon's own fields finally
   * appear in "Your place attributes"; `quality` is a FLOAT and gets a decimal
   * box rather than a rail that silently could not express the 4.5 the web
   * stores; and a user's own "Difficulty, 1-5" is drawn exactly like a V grade
   * without anything knowing about canyons.
   */
  const typeFieldDefs = useMemo(
    () => defsForType(customFieldDefs, placeTypeId),
    [customFieldDefs, placeTypeId],
  );

  /** The form in the shape both the validator and the ops speak. */
  const draft = useMemo(
    () => ({
      name: name.trim(),
      altNames: altNames
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
      latitude: parseNumber(latitude),
      longitude: parseNumber(longitude),
      notes: notes.trim() || null,
    }),
    [altNames, latitude, longitude, name, notes],
  );

  const save = useCallback(async () => {
    setInvalid(null);
    if (draft.name === "") {
      setInvalid("A place needs a name.");
      return;
    }
    const effectiveCustomFields = coerceCustomFields(fieldValues, typeFieldDefs);
    // The same predicate the API applies, run before anything is queued: a
    // rejected op would otherwise sit in the outbox as a dead push whose reason
    // the user never sees.
    const problem = validatePlacePayload(
      {
        // Cleared fields are dropped for the CHECK: `coerceCustomFields` writes
        // an explicit null so the merge below can remove the key, and the
        // validator must not be handed a null for a field simply not recorded.
        fieldValues: withoutClearedFields(effectiveCustomFields),
        ...(draft.latitude != null && { latitude: draft.latitude }),
        ...(draft.longitude != null && { longitude: draft.longitude }),
      },
      // The bounds come from the DEFINITIONS — the system ones (compiled in,
      // so the check works with no signal) AND the ones this type actually
      // renders. Checking only the system defs left every user field
      // unvalidated on the client: an out-of-range value queued, the server
      // refused it, and it parked as a sync issue — exactly the outcome this
      // check exists to prevent.
      {
        requireCoords: !editing,
        defs: [...SYSTEM_FIELD_DEFS, ...typeFieldDefs],
      },
    );
    if (problem) {
      setInvalid(problem);
      return;
    }

    setSaving(true);
    try {
      if (place) {
        // Field-scoped: push only what changed, so a concurrent edit to another
        // field on another device isn't clobbered (§6 LWW).
        const changes: Record<string, unknown> = {};
        if (draft.name !== place.name) changes.name = draft.name;
        if (!sameList(draft.altNames, place.altNames)) changes.altNames = draft.altNames;
        if (draft.latitude != null && draft.latitude !== place.latitude) {
          changes.latitude = draft.latitude;
        }
        if (draft.longitude != null && draft.longitude !== place.longitude) {
          changes.longitude = draft.longitude;
        }
        if (draft.notes !== place.notes) changes.notes = draft.notes;
        if (placeTypeId !== place.placeTypeId) changes.placeTypeId = placeTypeId;
        // `fieldValues` is replaced wholesale by the server, so the edit is
        // built OVER the place's existing values — `_sources`, which only the
        // web writes, and any key another client added would otherwise be
        // dropped by an edit made on the phone.
        // Built OVER the stored values, never rebuilt from the form: that is
        // what keeps `_sources`, another client's key, and — on a type change —
        // the OLD type's values, which the server needs in the payload to park
        // them in `foreignFields` rather than lose them (§2.6).
        const nextValues = withFieldValues(place.fieldValues, effectiveCustomFields);
        if (!sameFieldValues(nextValues, place.fieldValues ?? {})) {
          changes.fieldValues = nextValues;
        }
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        await updatePlaceLocal(place.id, changes);
        onSaved("Place updated.");
      } else {
        await createPlaceLocal({
          name: draft.name,
          // Non-null by the validation above: requireCoords is on for a create.
          latitude: draft.latitude as number,
          longitude: draft.longitude as number,
          altNames: draft.altNames,
          notes: draft.notes,
          placeTypeId,
          fieldValues: withFieldValues({}, effectiveCustomFields),
        });
        onSaved("Place added.");
      }
      onClose();
    } catch (err) {
      console.error(err);
      onFailed("Couldn't save this place.");
    } finally {
      setSaving(false);
    }
  }, [
    place,
    draft,
    editing,
    fieldValues,
    onClose,
    onFailed,
    onSaved,
    placeTypeId,
    typeFieldDefs,
  ]);

  const fieldForm = useCustomFieldForm({
    entity: "place",
    defs: customFieldDefs,
    editing: editingField,
    // Opened from a place's own form, so the type it is on is the default —
    // and still changeable, which is the whole of finding #17: this used to
    // REMOVE the scope picker, making the form reached from a place strictly
    // less capable than the identical form in Settings.
    initialTypeId: placeTypeId,
    onSaved: (next, message) => {
      setCustomFieldDefs(next);
      onSaved(message);
    },
    onFailed,
    onDone: () => setMode("fields"),
  });

  const title =
    mode === "date"
      ? (customFieldDefs.find((def) => def.key === dateFieldKey)?.label ?? "Date")
      : mode === "fields"
        ? `Your place ${ATTRIBUTE_NOUN.many}`
        : mode === "fieldForm"
          ? (editingField ? editingField.label : `New place ${ATTRIBUTE_NOUN.one}`)
          : editing
            ? "Edit place"
            : "Add a place";

  return (
    <BottomSheet
      visible={visible}
      // Inside a sub-mode, a drag or a backdrop tap means "back to the form" —
      // not "throw away everything I just typed".
      onClose={
        mode === "form"
          ? onClose
          : () => setMode(mode === "fieldForm" ? "fields" : "form")
      }
      title={title}
      // A sub-mode gets an arrow back to the mode it came from.
      onBack={
        mode === "form"
          ? undefined
          : () => setMode(mode === "fieldForm" ? "fields" : "form")
      }
      footer={
        mode === "form" ? (
          <Button
            label={editing ? "Save changes" : "Add place"}
            icon="check"
            loading={saving}
            onPress={() => void save()}
          />
        ) : mode === "fieldForm" ? (
          fieldForm.footer
        ) : mode === "fields" ? (
          // PINNED. It used to be the last row of the list, which put the one
          // action this mode exists for below however many rows were already
          // there.
          <Button
            label={ATTRIBUTE_NOUN.add}
            icon="plus"
            onPress={() => {
              setEditingField(null);
              setMode("fieldForm");
            }}
          />
        ) : (
          <Button label="Done" icon="check" onPress={() => setMode("form")} />
        )
      }
    >
      {mode === "date" && dateFieldKey ? (
        <View style={styles.modeBody}>
          <DatePicker
            value={fieldValues[dateFieldKey] || null}
            onChange={(key) =>
              setFieldValues((current) => ({ ...current, [dateFieldKey]: key }))
            }
          />
          {/* An attribute date may be unknown; a picker with no way back to
              blank turns that into a wrong answer. */}
          {fieldValues[dateFieldKey] ? (
            <Button
              label="Clear date"
              icon="x"
              variant="ghost"
              onPress={() => {
                setFieldValues((current) => ({ ...current, [dateFieldKey]: "" }));
                setMode("form");
              }}
            />
          ) : null}
        </View>
      ) : null}

      {mode === "fields" ? (
        <CustomFieldList
          entity="place"
          defs={typeFieldDefs}
          onEdit={(def) => {
            setEditingField(def);
            setMode("fieldForm");
          }}
        />
      ) : null}

      {mode === "fieldForm" ? fieldForm.body : null}

      {mode !== "form" ? null : (
      <View style={styles.form}>
        {invalid ? <ErrorBanner message={invalid} /> : null}

        {/* TYPE FIRST, because everything below it depends on the answer: the
            fields the form asks for, the colour of the pin, the tab it lands
            under. A rail rather than a wizard step — the form reshapes under
            it, so the choice is visible and reversible instead of a screen you
            have to go back through.

            Shown when editing too: miscategorising is inevitable, and
            retyping a place keeps its media, routes, links and trips where
            delete-and-recreate would lose them. Values the new type has no
            field for are kept and offered back (§2.6), never dropped. */}
        {typeOptions.length > 1 ? (
          <View style={styles.field}>
            <SectionHeader label="Type" />
            <SegmentedControl
              scroll
              options={typeOptions}
              value={placeTypeId}
              onChange={setPlaceTypeId}
            />
          </View>
        ) : null}

        <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
        <View style={styles.field}>
          <TextField
            label="Also known as"
            value={altNames}
            onChangeText={setAltNames}
            autoCapitalize="words"
          />
          <Text style={styles.hint}>
            Separate alternative names with commas — they&rsquo;re searchable too.
          </Text>
        </View>

        <SectionHeader label="Position" />
        <View style={styles.coordRow}>
          <View style={styles.coordField}>
            <TextField
              label="Latitude"
              value={latitude}
              onChangeText={setLatitude}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.coordField}>
            <TextField
              label="Longitude"
              value={longitude}
              onChangeText={setLongitude}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>
        {/* Under the coordinates it fills in, because that is what it does —
            not at the top as a second way to start, which is what the old
            two-option "Add a place" sheet made it. Nothing is lost by going:
            the form comes back exactly as it was left. */}
        {onPickOnMap ? (
          <Button
            label="Select on map"
            icon="map-pin"
            variant="outlineAccent"
            onPress={() =>
              onPickOnMap(
                draft.latitude != null && draft.longitude != null
                  ? { latitude: draft.latitude, longitude: draft.longitude }
                  : null,
              )
            }
          />
        ) : null}
        {!editing && initialCoords ? (
          <View style={styles.fixNote}>
            <Feather name="map-pin" size={14} color={theme.accent} />
            <Text style={styles.hint}>
              Filled in from the point you pressed.
            </Text>
          </View>
        ) : null}

        {/* No SectionHeader: the field's own label already says "Notes", and
            the pair printed it twice. */}
        <View style={styles.field}>
          <TextField
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            autoCapitalize="sentences"
          />
          <Text style={styles.hint}>
            Visible to anyone you share the place with. Per-trip notes stay private.
          </Text>
        </View>


        {/* Named for the TYPE, not for the user: on a Campsite these are
            Capacity and Is-a-cave, which are ours, not theirs. Absent when the
            type has none rather than standing over nothing. */}
        {typeFieldDefs.length > 0 ? (
          <SectionHeader
            label={`${typeName(placeTypeId, placeTypes.data)} ${ATTRIBUTE_NOUN.many}`}
          />
        ) : null}
        <CustomFieldValueInputs
          defs={typeFieldDefs}
          values={fieldValues}
          onChange={(key, next) =>
            setFieldValues((current) => ({ ...current, [key]: next }))
          }
          onPickDate={(key) => {
            setDateFieldKey(key);
            setMode("date");
          }}
        />
        {/* Definitions are local rows written through the outbox, so this door
            is open with no account and no signal, for everyone. */}
        <Row
          icon="sliders"
          title={`Your place ${ATTRIBUTE_NOUN.many}`}
          subtitle={
            typeFieldDefs.length === 0
              ? "Add your own — permits, access notes, anything."
              : `${typeFieldDefs.length} on this type`
          }
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
          onPress={() => setMode("fields")}
        />
      </View>
      )}
    </BottomSheet>
  );
}

/** A type's name for user copy. Falls back to the neutral noun rather than an
 *  id: a type this device has not pulled yet is a blank in a sentence, not a
 *  UUID in one. */
function typeName(
  typeId: string,
  types: { id: string; name: string }[] | null,
): string {
  return types?.find((type) => type.id === typeId)?.name ?? "place";
}

/** "" and an unparseable entry both mean "not recorded", not zero. */
function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function numberText(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

/**
 * A picked coordinate at 6 decimal places — about 10 cm, which is finer than any
 * map press or GPS fix, and readable. Stored values are never re-rounded on the
 * way through the edit form: only a NEW point gets this.
 */
const SEED_COORD_DECIMALS = 6;
function seedCoord(value: number | null | undefined): string {
  return value == null ? "" : String(Number(value.toFixed(SEED_COORD_DECIMALS)));
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

const styles = StyleSheet.create({
  form: { gap: spacing(1.5) },
  modeBody: { gap: spacing(2) },
  field: { gap: spacing(0.5) },
  hint: { color: theme.textMuted, fontSize: fontSize.sm, flex: 1 },
  coordRow: { flexDirection: "row", gap: spacing(1) },
  coordField: { flex: 1 },
  fixNote: { flexDirection: "row", alignItems: "center", gap: spacing(0.75) },
});
