import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  CANYONING_TRIP_TYPE,
  enforceCanyoningTag,
  formatTripPlaceNames,
  linksCanyon,
  MAX_PLACES_PER_TRIP,
  TRIP_TYPE_SUGGESTIONS,
  tripFieldDefs,
  type ScopedCustomFieldDef,
} from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, surface, theme, withAlpha } from "../theme";
import type { MirrorPlace, MirrorTrip } from "../sync/mirrorStore";
import {
  createTripLocal,
  updateTripLocal,
  type TripPlaceLink,
} from "../sync/outbox";
import {
  BottomSheet,
  Button,
  ChipPicker,
  DatePicker,
  Row,
  SectionHeader,
  TextField,
  toDateKey,
  todayDateKey,
  type ChipOption,
} from "../ui";
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
import { formatDateKey } from "./logbook";
import { tripTypeLabel, tripTypeMeta } from "./tripTypeMeta";

/**
 * Log or edit a trip — one sheet for both, because the fields are identical and
 * a second form would drift.
 *
 * The date picker and the place picker are MODES of this sheet, not sheets of
 * their own (DESIGN.md §6: never open a second sheet from the first). The
 * header title changes with the mode, so the user always knows which step they
 * are on, and there is exactly one animation per tap.
 *
 * PRIVACY: place names are the sensitive payload here. They stay in component
 * state and go out only through the outbox's authed push — nothing is logged,
 * and there is no autosaved draft (the web's localStorage draft has no mobile
 * equivalent: the OS doesn't evict this form mid-edit the way a browser tab
 * gets reclaimed).
 */
type Mode = "form" | "date" | "places" | "fields" | "fieldForm";

/** The `canyoning` tag is locked on while a canyon is linked — the server
 *  force-adds it, so the picker shows it selected and not toggleable. */
const CANYONING_LOCKED = new Set([CANYONING_TRIP_TYPE]);

/** Which date the picker mode is editing: the trip's, or a custom date field. */
type DateTarget = { kind: "trip" } | { kind: "field"; key: string };

export function TripEditSheet({
  visible,
  onClose,
  trip,
  places,
  initialPlaces,
  existingTypes,
  onSaved,
  onFailed,
  online,
}: {
  visible: boolean;
  onClose: () => void;
  /** null/undefined = log a new trip. */
  trip?: MirrorTrip | null;
  places: MirrorPlace[];
  /**
   * Pre-linked places for a NEW trip, so "log a trip here" arrives with the
   * place already attached. Ignored when editing — an existing trip's links
   * are its own.
   */
  initialPlaces?: TripPlaceLink[];
  /** Types across the user's own history, unioned with the seed vocabulary. */
  existingTypes: string[];
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
  /**
   * Trip edits queue offline, but field DEFINITIONS are an account-level
   * preference that needs the network — so that one door is closed with a
   * reason rather than opened onto a failure.
   */
  online: boolean;
}) {
  const editing = trip != null;
  const [mode, setMode] = useState<Mode>("form");
  const [dateKey, setDateKey] = useState(todayDateKey);
  const [selected, setSelected] = useState<TripPlaceLink[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [placeSearch, setPlaceSearch] = useState("");
  const [dateTarget, setDateTarget] = useState<DateTarget>({ kind: "trip" });
  // Custom-field VALUES are held as strings while editing (like the web form)
  // and coerced to their declared type on save.
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const {
    defs: customFieldDefs,
    setDefs: setCustomFieldDefs,
  } = useFieldDefs("tripLog");
  const [editingField, setEditingField] = useState<ScopedCustomFieldDef | null>(null);
  // The attribute keys this form keeps whatever the tags say. See
  // `visibleFieldDefs`.
  const [keptKeys, setKeptKeys] = useState<ReadonlySet<string>>(() => new Set());
  const keepField = useCallback((key: string) => {
    setKeptKeys((current) => (current.has(key) ? current : new Set(current).add(key)));
  }, []);
  // The trip as it was when the sheet OPENED. Save diffs against this, not the
  // live row: a sync landing mid-edit must neither reset the form nor make a
  // field the user never touched look changed (and so get pushed over the
  // newer value).
  const openedWith = useRef<MirrorTrip | null>(null);

  /**
   * THE FIELDS THIS TRIP IS ASKED FOR — the ones scoped to the trip's own TYPES
   * (the chips below) — and, after them, the ones it only KEEPS.
   *
   * A packrafting trip is asked the packrafting questions; an untagged one only
   * the always-on ones. The save below writes exactly the fields the form
   * shows, so anything that already holds a value must stay on screen when a
   * tag comes off, or the save drops it: the keys stored when the sheet opened,
   * and the keys typed into since (tick a tag, fill in its attribute, untick
   * it). Keyed on EDITED, not on "has a value now", or backspacing to empty
   * would unmount the field under the cursor.
   *
   * Kept-only fields sit in their own section with a remove button, because
   * clearing is not a way out for every kind — a date had no empty state until
   * "Clear date", and nothing said which fields were leftovers. Removing drops
   * the key from `keptKeys`, so the field leaves the form and the save leaves it
   * out; closing without saving brings it back, which is why there is no
   * confirm.
   */
  const visibleFieldDefs = useMemo(
    () => tripFieldDefs(customFieldDefs, types, null, keptKeys),
    [customFieldDefs, keptKeys, types],
  );
  const askedFieldDefs = useMemo(
    () => tripFieldDefs(customFieldDefs, types, null),
    [customFieldDefs, types],
  );
  const keptOnlyFieldDefs = visibleFieldDefs.filter(
    (def) => !askedFieldDefs.includes(def),
  );
  const removeField = useCallback((key: string) => {
    setKeptKeys((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setFieldValues((current) => ({ ...current, [key]: "" }));
  }, []);

  // Seed from the trip being edited (or today's blank form) each time the sheet
  // opens, so a cancelled edit never leaks into the next one.
  useEffect(() => {
    if (!visible) return;
    openedWith.current = trip ?? null;
    setMode("form");
    setPlaceSearch("");
    setCustomTypes([]);
    setSaving(false);
    setDateKey(trip ? toDateKey(new Date(trip.date)) : todayDateKey());
    setSelected(
      trip ? trip.places.map((link) => ({ ...link })) : (initialPlaces ?? []),
    );
    setDisplayName(trip?.displayName ?? "");
    setTypes(trip?.types ?? []);
    setNotes(trip?.notes ?? "");
    setDateTarget({ kind: "trip" });
    setEditingField(null);
    setFieldValues(fieldValueStrings(trip?.customFields));
    setKeptKeys(
      new Set(
        Object.entries(trip?.customFields ?? {})
          .filter(([, value]) => value != null)
          .map(([key]) => key),
      ),
    );
    // Deliberately keyed on the sheet OPENING — the trip's ID, not the object.
    // A detail screen hands this a fresh object on every mirror change (a sync
    // pull, an upload tick, an inbox refresh), and re-seeding on that wiped
    // whatever the user was halfway through typing. `initialPlaces` is left out
    // for the same reason: callers build that array inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, visible]);

  // Linking a CANYON means "I did that canyon", so the API force-tags
  // `canyoning` on save. Mirror that into the selection so the chip reads
  // SELECTED the moment a canyon is linked — and it is LOCKED (see
  // CANYONING_LOCKED) rather than toggleable, because the server re-adds it on
  // save anyway, so a chip the user could "deselect" would be a lie.
  // enforceCanyoningTag only ever force-ADDS, so unlinking the canyon leaves an
  // existing `canyoning` alone (a canyon-less trip can still be canyoning) —
  // and with no canyon linked the chip is a normal toggle. A campsite or a
  // marker is not a canyon: linking one tags nothing.
  const linkedCanyon = linksCanyon(
    selected
      .map((link) => places.find((place) => place.id === link.id)?.placeTypeId)
      .filter((typeId): typeId is string => !!typeId),
  );
  useEffect(() => {
    setTypes((prev) => enforceCanyoningTag(prev, linkedCanyon));
  }, [linkedCanyon]);

  const typeOptions: ChipOption[] = useMemo(() => {
    const vocabulary = [
      ...new Set([...TRIP_TYPE_SUGGESTIONS, ...existingTypes, ...customTypes, ...types]),
    ];
    return vocabulary.map((type) => ({
      value: type,
      label: tripTypeLabel(type),
      hue: tripTypeMeta(type).hue,
      icon: tripTypeMeta(type).icon,
    }));
  }, [customTypes, existingTypes, types]);

  const toggleType = useCallback((type: string) => {
    setTypes((current) =>
      current.includes(type)
        ? current.filter((entry) => entry !== type)
        : [...current, type],
    );
  }, []);

  const addType = useCallback(
    (label: string) => {
      // Case-insensitive: the API rejects case-variant duplicates.
      const existing = typeOptions.find(
        (option) => option.value.toLowerCase() === label.toLowerCase(),
      );
      const value = existing?.value ?? label;
      setCustomTypes((current) =>
        current.includes(value) ? current : [...current, value],
      );
      setTypes((current) => (current.includes(value) ? current : [...current, value]));
    },
    [typeOptions],
  );

  const togglePlace = useCallback(
    (place: MirrorPlace) => {
      setSelected((current) => {
        if (current.some((link) => link.id === place.id)) {
          return current.filter((link) => link.id !== place.id);
        }
        if (current.length >= MAX_PLACES_PER_TRIP) {
          onFailed(`A trip can have at most ${MAX_PLACES_PER_TRIP} places.`);
          return current;
        }
        return [...current, { id: place.id, name: place.name }];
      });
    },
    [onFailed],
  );

  const setFieldValue = useCallback(
    (key: string, next: string) => {
      keepField(key);
      setFieldValues((current) => ({ ...current, [key]: next }));
    },
    [keepField],
  );

  const save = useCallback(async () => {
    setSaving(true);
    const trimmedName = displayName.trim();
    const trimmedNotes = notes.trim();
    // The canyoning tag a linked canyon implies — applied here so the chips the
    // user just saw are exactly what the server will store (shared derivation).
    const effectiveTypes = enforceCanyoningTag(types, linkedCanyon);
    const isoDate = `${dateKey}T00:00:00.000Z`;
    // Only the fields the form actually showed. A definition scoped to a type
    // this trip does not visit was never asked, and writing a null for it
    // would be the form inventing an answer.
    // A trip's `customFields` is REPLACED wholesale rather than merged, so a
    // cleared field is absent here rather than null — there is nothing on the
    // other side to clear.
    const effectiveCustomFields = withoutClearedFields(
      coerceCustomFields(fieldValues, visibleFieldDefs),
    );
    const base = openedWith.current ?? trip;
    try {
      if (trip && base) {
        // Field-scoped: push only what the user changed since the sheet opened,
        // so a concurrent edit to another field on another device isn't
        // clobbered (§6 LWW).
        const changes: Parameters<typeof updateTripLocal>[1] = {};
        if (isoDate !== new Date(base.date).toISOString()) changes.date = isoDate;
        if ((trimmedName || null) !== base.displayName) {
          changes.displayName = trimmedName || null;
        }
        if ((trimmedNotes || null) !== base.notes) changes.notes = trimmedNotes || null;
        if (!sameOrder(effectiveTypes, base.types)) changes.types = effectiveTypes;
        if (!sameFieldValues(effectiveCustomFields, base.customFields ?? {})) {
          changes.customFields = effectiveCustomFields;
        }
        if (
          !sameOrder(
            selected.map((link) => link.id),
            base.places.map((link) => link.id),
          )
        ) {
          changes.places = selected;
        }
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        await updateTripLocal(trip.id, changes);
        onSaved("Trip updated.");
      } else {
        await createTripLocal({
          date: isoDate,
          displayName: trimmedName || null,
          notes: trimmedNotes || null,
          types: effectiveTypes,
          customFields: effectiveCustomFields,
          places: selected,
        });
        onSaved("Trip logged.");
      }
      onClose();
    } catch (err) {
      // The message is ours, not the error's: an error string could carry a
      // place name into a toast (and from there a screenshot).
      console.error(err);
      onFailed("Couldn't save this trip.");
    } finally {
      setSaving(false);
    }
  }, [
    visibleFieldDefs,
    dateKey,
    displayName,
    fieldValues,
    linkedCanyon,
    notes,
    onClose,
    onFailed,
    onSaved,
    selected,
    trip,
    types,
  ]);

  const fieldForm = useCustomFieldForm({
    entity: "tripLog",
    defs: customFieldDefs,
    editing: editingField,
    onSaved: (next, message) => {
      setCustomFieldDefs(next);
      onSaved(message);
    },
    onFailed,
    onDone: () => setMode("fields"),
  });

  const derivedTitle = formatTripPlaceNames(selected.map((link) => link.name));
  const title =
    mode === "date"
      ? dateTarget.kind === "trip"
        ? "Trip date"
        : (visibleFieldDefs.find((def) => def.key === dateTarget.key)?.label ?? "Date")
      : mode === "places"
        ? "Places on this trip"
        : mode === "fields"
          ? `Your trip ${ATTRIBUTE_NOUN.many}`
          : mode === "fieldForm"
            ? (editingField ? editingField.label : `New trip ${ATTRIBUTE_NOUN.one}`)
            : editing
              ? "Edit trip"
              : "Log a trip";

  const pickFieldDate = (key: string) => {
    setDateTarget({ kind: "field", key });
    setMode("date");
  };

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
      // Pinned, because the place list is longer than the sheet: a Done button
      // that scrolls out of reach leaves the handle as the only exit.
      footer={
        mode === "form" ? (
          <Button
            label={editing ? "Save changes" : "Log trip"}
            icon="check"
            loading={saving}
            onPress={() => void save()}
          />
        ) : mode === "fieldForm" ? (
          fieldForm.footer
        ) : mode === "fields" ? (
          // PINNED, for the same reason the Done button is: the one action this
          // mode exists for must not sit below however many rows are already
          // in the list.
          <Button
            label={ATTRIBUTE_NOUN.add}
            icon="plus"
            onPress={() => {
              setEditingField(null);
              setMode("fieldForm");
            }}
          />
        ) : (
          <Button
            label="Done"
            icon="check"
            onPress={() => setMode("form")}
          />
        )
      }
    >
      {mode === "date" ? (
        <View style={styles.modeBody}>
          <DatePicker
            value={dateTarget.kind === "trip" ? dateKey : (fieldValues[dateTarget.key] || null)}
            onChange={(key) => {
              if (dateTarget.kind === "trip") {
                setDateKey(key);
                return;
              }
              setFieldValue(dateTarget.key, key);
            }}
          />
          {/* A trip always has a date; an attribute date may be unknown, and
              a picker with no way back to blank turns that into a wrong
              answer — the same reason a rail starts with "—". */}
          {dateTarget.kind === "field" && fieldValues[dateTarget.key] ? (
            <Button
              label="Clear date"
              icon="x"
              variant="ghost"
              onPress={() => {
                setFieldValue(dateTarget.key, "");
                setMode("form");
              }}
            />
          ) : null}
        </View>
      ) : null}

      {mode === "fields" ? (
        <CustomFieldList
          entity="tripLog"
          defs={customFieldDefs}
          onEdit={(def) => {
            setEditingField(def);
            setMode("fieldForm");
          }}
        />
      ) : null}

      {mode === "fieldForm" ? fieldForm.body : null}

      {mode === "places" ? (
        <PlacePicker
          places={places}
          selected={selected}
          search={placeSearch}
          onSearch={setPlaceSearch}
          onToggle={togglePlace}
        />
      ) : null}

      {mode === "form" ? (
        <View style={styles.form}>
          <Row
            icon="calendar"
            title={formatDateKey(`${dateKey}T00:00:00.000Z`)}
            subtitle="Date"
            right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
            onPress={() => setMode("date")}
          />
          <Row
            icon="map-pin"
            title={derivedTitle ?? "No places linked"}
            subtitle={
              selected.length === 1 ? "1 place" : `${selected.length} places`
            }
            titleNumberOfLines={2}
            right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
            onPress={() => setMode("places")}
          />

          <View style={styles.field}>
            <TextField
              label="Title"
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="sentences"
            />
            {!displayName.trim() ? (
              <Text style={styles.hint}>
                Defaults to {derivedTitle ?? "“Untitled trip”"}
              </Text>
            ) : null}
          </View>

          <ChipPicker
            label="Type"
            options={typeOptions}
            selected={types}
            onToggle={toggleType}
            onAdd={addType}
            addPlaceholder="Other"
            disabledValues={linkedCanyon ? CANYONING_LOCKED : undefined}
          />

          <View style={styles.field}>
            <TextField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              multiline
              autoCapitalize="sentences"
            />
          </View>

          <CustomFieldValueInputs
            defs={askedFieldDefs}
            values={fieldValues}
            onChange={setFieldValue}
            onPickDate={pickFieldDate}
          />

          {/* Not a place's "Doesn't fit this type" and its three actions:
              these are the user's own definitions, so there is nothing to
              adopt — only keep or remove. */}
          {keptOnlyFieldDefs.length > 0 ? (
            <>
              <SectionHeader
                label={`Leftover ${ATTRIBUTE_NOUN.many} · ${keptOnlyFieldDefs.length}`}
              />
              <Text style={styles.hint}>
                These {ATTRIBUTE_NOUN.many} are left over from when this trip was saved
                as a different type.
              </Text>
              <CustomFieldValueInputs
                defs={keptOnlyFieldDefs}
                values={fieldValues}
                onChange={setFieldValue}
                onPickDate={pickFieldDate}
                onRemove={removeField}
              />
            </>
          ) : null}

          {/* Definitions are local rows written through the outbox, so this
              door is open with no account and no signal, for everyone. */}
          <Row
            icon="sliders"
            title={`Your trip ${ATTRIBUTE_NOUN.many}`}
            subtitle={
              customFieldDefs.length === 0
                ? "Add your own — water level, party size, anything"
                : `${customFieldDefs.length} ${customFieldDefs.length === 1 ? ATTRIBUTE_NOUN.one : ATTRIBUTE_NOUN.many}`
            }
            right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
            onPress={() => setMode("fields")}
          />
        </View>
      ) : null}
    </BottomSheet>
  );
}

/** Order-sensitive comparison — a trip's place order drives its derived title. */
function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Searchable multi-select over the place library. Selected places pin to the
 * top in selection order, because that order is what the derived trip title
 * reads — "Claustral and Ranon" is a different title from "Ranon and Claustral".
 */
function PlacePicker({
  places,
  selected,
  search,
  onSearch,
  onToggle,
}: {
  places: MirrorPlace[];
  selected: TripPlaceLink[];
  search: string;
  onSearch: (next: string) => void;
  onToggle: (place: MirrorPlace) => void;
}) {
  const selectedIds = new Set(selected.map((link) => link.id));
  const query = search.trim().toLowerCase();
  const matches = places.filter(
    (place) => !selectedIds.has(place.id) && place.name.toLowerCase().includes(query),
  );
  const pinned = selected
    .map((link) => places.find((place) => place.id === link.id))
    .filter((place): place is MirrorPlace => place != null);

  return (
    <View style={styles.pickerBody}>
      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color={theme.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={onSearch}
          placeholder="Search your places"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel="Search your places"
          autoCapitalize="none"
        />
      </View>

      {pinned.length > 0 ? (
        <>
          <SectionHeader label={`On this trip · ${pinned.length}`} />
          {pinned.map((place, index) => (
            <Row
              key={place.id}
              icon="check"
              hue={theme.accent}
              title={place.name}
              subtitle={`${index + 1} of ${pinned.length}`}
              onPress={() => onToggle(place)}
              accessibilityLabel={`Remove ${place.name} from this trip`}
            />
          ))}
        </>
      ) : null}

      <SectionHeader label={query ? "Matches" : "Your places"} />
      {matches.length === 0 ? (
        <Text style={styles.hint}>
          {places.length === 0
            ? "No places saved on this device yet. You can log the trip now and link a place later."
            : "Nothing matches that name."}
        </Text>
      ) : (
        matches.map((place) => (
          <Row
            key={place.id}
            icon="plus"
            hue={theme.bonus1}
            title={place.name}
            onPress={() => onToggle(place)}
            accessibilityLabel={`Add ${place.name} to this trip`}
          />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing(1) },
  modeBody: { gap: spacing(2) },
  pickerBody: { gap: spacing(1) },
  field: { gap: spacing(0.5) },
  hint: { color: theme.textMuted, fontSize: fontSize.sm },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(theme.bonus1, 0.4),
    backgroundColor: surface.card,
    paddingHorizontal: spacing(1.5),
    minHeight: 44,
  },
  searchInput: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.regular,
  },
});
