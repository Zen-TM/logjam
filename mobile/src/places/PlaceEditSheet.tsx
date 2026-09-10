import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  defsForType,
  normalizePlaceTags,
  CANYON_FORM_FIELD_KEYS,
  numericFieldValue,
  PLACE_TAG_SUGGESTIONS,
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
import { CustomFieldForm, CustomFieldList } from "../customFields/CustomFieldsEditor";
import { CustomFieldValueInputs } from "../customFields/CustomFieldValues";
import {
  coerceCustomFields,
  fieldValueStrings,
} from "../customFields/fieldValueCoercion";
import { useFieldDefs } from "../customFields/useFieldDefs";
import { useMirrorPlaces, useMirrorPlaceTypes } from "../sync/useSyncQueries";
import { placeTypeFeatherIcon } from "./placeTypeIcon";
import {
  BottomSheet,
  Button,
  ChipPicker,
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
  const [vGrade, setVGrade] = useState("");
  const [aGrade, setAGrade] = useState("");
  const [commitment, setCommitment] = useState("");
  const [quality, setQuality] = useState("");
  const [numAbseils, setNumAbseils] = useState("");
  const [longestAbseil, setLongestAbseil] = useState("");
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [placeTypeId, setPlaceTypeId] = useState<string>(SYSTEM_PLACE_TYPE_IDS.canyon);
  const [tags, setTags] = useState<string[]>([]);
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
    // The seven grades are FIELD VALUES now, read by their reserved keys.
    setVGrade(numberText(numericFieldValue(place?.fieldValues, "v_grade")));
    setAGrade(numberText(numericFieldValue(place?.fieldValues, "a_grade")));
    setCommitment(numberText(numericFieldValue(place?.fieldValues, "commitment")));
    setQuality(numberText(numericFieldValue(place?.fieldValues, "quality")));
    setNumAbseils(numberText(numericFieldValue(place?.fieldValues, "num_abseils")));
    setLongestAbseil(
      numberText(numericFieldValue(place?.fieldValues, "longest_abseil")),
    );
    setHours(numberText(numericFieldValue(place?.fieldValues, "hours")));
    setNotes(place?.notes ?? "");
    // A new place starts as a CANYON: this is a canyoning app, and a default
    // that is right most of the time beats a picker with nothing chosen. The
    // rail is right there to say otherwise.
    setPlaceTypeId(place?.placeTypeId ?? SYSTEM_PLACE_TYPE_IDS.canyon);
    setTags(place?.tags ?? []);
    setMode("form");
    setEditingField(null);
    setDateFieldKey(null);
    setFieldValues(fieldValueStrings(userFieldValues(place?.fieldValues)));
  }, [place, initialCoords, visible]);

  // A point back from the picker touches the two coordinate fields and nothing
  // else — everything else on this form is what the user was in the middle of
  // typing. Trimmed like any freshly picked point: a map tap carries fifteen
  // meaningless decimals.
  useEffect(() => {
    if (!pickedCoords) return;
    setLatitude(seedCoord(pickedCoords.latitude));
    setLongitude(seedCoord(pickedCoords.longitude));
  }, [pickedCoords]);

  const isCanyon = placeTypeId === SYSTEM_PLACE_TYPE_IDS.canyon;

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

  /** The tag vocabulary: a seed list unioned with every tag already in use on
   *  this device. There is no registry to curate — same rule as trip types. */
  const allPlaces = useMirrorPlaces();
  const tagOptions = useMemo(() => {
    const used = new Set<string>(PLACE_TAG_SUGGESTIONS);
    for (const row of allPlaces.data ?? []) {
      for (const tag of row.tags) used.add(tag);
    }
    return [...used]
      .sort((a, b) => a.localeCompare(b))
      .map((tag) => ({ value: tag, label: tag }));
  }, [allPlaces.data]);
  /**
   * The fields THIS type's form asks for.
   *
   * The seven canyon axes have their own inputs above (a grade rail is a
   * better control than a number box, and they are what this app is for), so
   * on a canyon they are cut from the generic list rather than asked twice. On
   * every other type they are not in the list at all — a campsite's defs do not
   * include `v_grade`, which is the entire point of scoping.
   *
   * Cut by `CANYON_FORM_FIELD_KEYS` and NOT by `RESERVED_FIELD_KEYS`: reserved
   * means "a user may not take this key", which is also true of the campsite's
   * `capacity` and `is a cave?` — system fields that nothing draws specially
   * and that must render generically or not at all.
   */
  const typeFieldDefs = useMemo(
    () =>
      defsForType(customFieldDefs, placeTypeId).filter(
        (def) => !(isCanyon && CANYON_FORM_FIELD_KEYS.has(def.key)),
      ),
    [customFieldDefs, isCanyon, placeTypeId],
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
      vGrade: parseNumber(vGrade),
      aGrade: parseNumber(aGrade),
      commitment: parseNumber(commitment),
      quality: parseNumber(quality),
      numAbseils: parseNumber(numAbseils),
      longestAbseil: parseNumber(longestAbseil),
      hours: parseNumber(hours),
      notes: notes.trim() || null,
    }),
    [
      aGrade,
      altNames,
      commitment,
      hours,
      latitude,
      longestAbseil,
      longitude,
      name,
      notes,
      numAbseils,
      quality,
      vGrade,
    ],
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
        fieldValues: { ...definedNumbers(draft), ...effectiveCustomFields },
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

    // Normalised HERE for the same reason the outbox validates before enqueue:
    // the server refuses a malformed list, and a rejected op is a sync issue
    // the user has to resolve by hand rather than a message they can act on.
    const normalizedTags = normalizePlaceTags(tags);
    if ("error" in normalizedTags) {
      setInvalid(normalizedTags.error);
      return;
    }
    const nextTags = normalizedTags.tags ?? [];
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
        if (!sameList(nextTags, place.tags)) changes.tags = nextTags;
        // `fieldValues` is replaced wholesale by the server, so the edit is
        // built OVER the place's existing values — `_sources`, which only the
        // web writes, and any key another client added would otherwise be
        // dropped by an edit made on the phone.
        // Built OVER the stored values, never rebuilt from the form: that is
        // what keeps `_sources`, another client's key, and — on a type change —
        // the OLD type's values, which the server needs in the payload to park
        // them in `foreignFields` rather than lose them (§2.6).
        const nextValues = withFieldValues(place.fieldValues, {
          ...effectiveCustomFields,
          ...(isCanyon ? definedGrades(draft) : {}),
        });
        if (
          JSON.stringify(nextValues) !==
          JSON.stringify(place.fieldValues ?? {})
        ) {
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
          ...(nextTags.length > 0 && { tags: nextTags }),
          fieldValues: withFieldValues(
            {},
            {
              ...effectiveCustomFields,
              ...(isCanyon ? definedGrades(draft) : {}),
            },
          ),
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
    isCanyon,
    onClose,
    onFailed,
    onSaved,
    placeTypeId,
    tags,
    typeFieldDefs,
  ]);

  const title =
    mode === "date"
      ? (customFieldDefs.find((def) => def.key === dateFieldKey)?.label ?? "Date")
      : mode === "fields"
        ? "Your place fields"
        : mode === "fieldForm"
          ? (editingField ? "Edit field" : "New field")
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
      footer={
        mode === "form" ? (
          <Button
            label={editing ? "Save changes" : "Add place"}
            icon="check"
            loading={saving}
            onPress={() => void save()}
          />
        ) : mode === "fieldForm" ? (
          // Its own body carries the save action; this is just the way back.
          <Button label="Cancel" variant="outlineAccent" onPress={() => setMode("fields")} />
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
        </View>
      ) : null}

      {mode === "fields" ? (
        <CustomFieldList
          entity="place"
          defs={typeFieldDefs}
          onAdd={() => {
            setEditingField(null);
            setMode("fieldForm");
          }}
          onEdit={(def) => {
            setEditingField(def);
            setMode("fieldForm");
          }}
        />
      ) : null}

      {mode === "fieldForm" ? (
        <CustomFieldForm
          entity="place"
          defs={customFieldDefs}
          editing={editingField}
          // Opened from a place's own form, so the answer to "where does this
          // field appear" is already given: on this type.
          scopeToTypeId={placeTypeId}
          onSaved={(next, message) => {
            setCustomFieldDefs(next);
            onSaved(message);
          }}
          onFailed={onFailed}
          onDone={() => setMode("fields")}
        />
      ) : null}

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
            {editing && place && placeTypeId !== place.placeTypeId ? (
              <Text style={styles.hint}>
                Anything {typeName(place.placeTypeId, placeTypes.data)} records
                that a {typeName(placeTypeId, placeTypes.data)} doesn&rsquo;t is
                kept on this place. Once you have a connection you can add it
                back or discard it from the place&rsquo;s own screen.
              </Text>
            ) : null}
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

        {/* The seven canyon axes, and ONLY on a canyon. A campsite has no
            vertical grade, and asking for one was the whole complaint this
            rework answers. */}
        {isCanyon ? (
          <>
        <SectionHeader label="Grade" />
        <GradePicker label="Vertical (V)" axis="v_grade" value={vGrade} onChange={setVGrade} />
        <GradePicker label="Aquatic (A)" axis="a_grade" value={aGrade} onChange={setAGrade} />
        <GradePicker
          label="Commitment"
          axis="commitment"
          value={commitment}
          onChange={setCommitment}
        />
        <GradePicker label="Quality" axis="quality" value={quality} onChange={setQuality} />

        <SectionHeader label="Logistics" />
        <TextField
          label="Abseils"
          value={numAbseils}
          onChangeText={setNumAbseils}
          keyboardType="number-pad"
        />
        <TextField
          label="Longest abseil (m)"
          value={longestAbseil}
          onChangeText={setLongestAbseil}
          keyboardType="numeric"
        />
        <TextField label="Hours" value={hours} onChangeText={setHours} keyboardType="numeric" />
          </>
        ) : null}

        {/* No SectionHeader: the field's own label already says "Notes", and
            the pair printed it twice. Same reason Tags has none. */}
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

        {/* TAGS. Type-neutral — a carpark tag means the same thing on a
            marker and on a canyon — and the vocabulary is what is already in
            use plus a seed list, never a closed enum. This is where the old
            waypoint sheet's tags mode went. */}
        {/* No SectionHeader: `ChipPicker` renders its own label, and the pair
            printed "TAGS" twice. */}
        <ChipPicker
          label="Tags"
          options={tagOptions}
          selected={tags}
          onToggle={(tag) =>
            setTags((current) =>
              current.includes(tag)
                ? current.filter((existing) => existing !== tag)
                : [...current, tag],
            )
          }
          onAdd={(entry) => {
            const tag = entry.trim();
            // The server refuses case-insensitive duplicates, so a typed tag
            // already on this place is a no-op rather than an add.
            if (
              !tag ||
              tags.some((current) => current.toLowerCase() === tag.toLowerCase())
            ) {
              return;
            }
            setTags((current) => [...current, tag]);
          }}
          addPlaceholder="New tag"
        />

        {/* Named for the TYPE, not for the user: on a Campsite these are
            Capacity and Is-a-cave, which are ours, not theirs. The header is
            absent when the type has no fields of its own rather than standing
            over nothing — on a canyon the seven axes are drawn above by their
            own controls, so the generic list is usually empty. */}
        {typeFieldDefs.length > 0 ? (
          <SectionHeader label={`${typeName(placeTypeId, placeTypes.data)} fields`} />
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
          title="Your place fields"
          subtitle={
            typeFieldDefs.length === 0
              ? "Add your own — permits, access notes, anything."
              : `${typeFieldDefs.length} field${typeFieldDefs.length === 1 ? "" : "s"} on this type`
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

/**
 * A graded axis as a single-select rail with an explicit "not recorded" stop.
 * Unset has to be reachable: most imported places have gaps, and a picker with
 * no way back to blank turns "I don't know" into a wrong answer.
 */
function GradePicker({
  label,
  axis,
  value,
  onChange,
}: {
  label: string;
  /** A reserved field key — the picker's stops come from that definition's
   *  own bounds, which is the only place they are declared. */
  axis: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const def = SYSTEM_FIELD_DEFS.find((candidate) => candidate.key === axis);
  const min = def?.min ?? 1;
  const max = def?.max ?? 7;
  const options: SegmentOption<string>[] = [{ value: "", label: "—" }];
  for (let stop = min; stop <= max; stop += 1) {
    options.push({ value: String(stop), label: String(stop) });
  }
  return (
    <View style={styles.gradeRow}>
      <Text style={styles.gradeLabel}>{label}</Text>
      <SegmentedControl scroll options={options} value={value} onChange={onChange} />
    </View>
  );
}

// The form's seven numeric inputs, and the reserved key each one writes. The
// draft still names them the way a canyon does; this is where that becomes a
// field key.
const GRADE_KEYS: Record<string, string> = {
  vGrade: "v_grade",
  aGrade: "a_grade",
  commitment: "commitment",
  quality: "quality",
  numAbseils: "num_abseils",
  longestAbseil: "longest_abseil",
  hours: "hours",
};

/** Only the fields the user actually filled in — the validator must not be
 *  handed an explicit null for a field that simply isn't recorded. */
function definedNumbers(draft: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [draftKey, fieldKey] of Object.entries(GRADE_KEYS)) {
    const value = draft[draftKey];
    if (typeof value === "number") out[fieldKey] = value;
  }
  return out;
}

/** The same seven, but keeping the CLEARED ones as null so `setFieldValues`
 *  removes them — clearing a grade has to be expressible, and an omitted key
 *  would silently leave the old value in place. */
function definedGrades(draft: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [draftKey, fieldKey] of Object.entries(GRADE_KEYS)) {
    out[fieldKey] = draft[draftKey] ?? null;
  }
  return out;
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
  gradeRow: { gap: spacing(0.5) },
  gradeLabel: { color: theme.textPrimary, fontSize: fontSize.sm },
});
