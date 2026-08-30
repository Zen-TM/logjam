import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  CANYONING_TRIP_TYPE,
  enforceCanyoningTag,
  formatTripCanyonNames,
  MAX_CANYONS_PER_TRIP,
  TRIP_TYPE_SUGGESTIONS,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, surface, theme, withAlpha } from "../theme";
import type { MirrorCanyon, MirrorTrip } from "../sync/mirrorStore";
import {
  createTripLocal,
  updateTripLocal,
  type TripCanyonLink,
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
import { useAccountState } from "../auth/AccountStateContext";
import { fieldDefsBlockedReason } from "../auth/capabilities";
import { CustomFieldForm, CustomFieldList } from "../customFields/CustomFieldsEditor";
import {
  coerceCustomFields,
  CustomFieldValueInputs,
  fieldValueStrings,
} from "../customFields/CustomFieldValues";
import { useFieldDefs } from "../customFields/useFieldDefs";
import { formatDateKey } from "./logbook";
import { tripTypeLabel, tripTypeMeta } from "./tripTypeMeta";

/**
 * Log or edit a trip — one sheet for both, because the fields are identical and
 * a second form would drift.
 *
 * The date picker and the canyon picker are MODES of this sheet, not sheets of
 * their own (DESIGN.md §6: never open a second sheet from the first). The
 * header title changes with the mode, so the user always knows which step they
 * are on, and there is exactly one animation per tap.
 *
 * PRIVACY: canyon names are the sensitive payload here. They stay in component
 * state and go out only through the outbox's authed push — nothing is logged,
 * and there is no autosaved draft (the web's localStorage draft has no mobile
 * equivalent: the OS doesn't evict this form mid-edit the way a browser tab
 * gets reclaimed).
 */
type Mode = "form" | "date" | "canyons" | "fields" | "fieldForm";

/** The `canyoning` tag is locked on while a canyon is linked — the server
 *  force-adds it, so the picker shows it selected and not toggleable. */
const CANYONING_LOCKED = new Set([CANYONING_TRIP_TYPE]);

/** Which date the picker mode is editing: the trip's, or a custom date field. */
type DateTarget = { kind: "trip" } | { kind: "field"; key: string };

export function TripEditSheet({
  visible,
  onClose,
  trip,
  canyons,
  initialCanyons,
  existingTypes,
  onSaved,
  onFailed,
  online,
}: {
  visible: boolean;
  onClose: () => void;
  /** null/undefined = log a new trip. */
  trip?: MirrorTrip | null;
  canyons: MirrorCanyon[];
  /**
   * Pre-linked canyons for a NEW trip, so "log a trip here" arrives with the
   * canyon already attached. Ignored when editing — an existing trip's links
   * are its own.
   */
  initialCanyons?: TripCanyonLink[];
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
  const { accountState } = useAccountState();
  const [mode, setMode] = useState<Mode>("form");
  const [dateKey, setDateKey] = useState(todayDateKey);
  const [selected, setSelected] = useState<TripCanyonLink[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [canyonSearch, setCanyonSearch] = useState("");
  const [dateTarget, setDateTarget] = useState<DateTarget>({ kind: "trip" });
  // Custom-field VALUES are held as strings while editing (like the web form)
  // and coerced to their declared type on save.
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const {
    defs: customFieldDefs,
    setDefs: setCustomFieldDefs,
  } = useFieldDefs("tripLog");
  const [editingField, setEditingField] = useState<TripLogCustomFieldDef | null>(null);

  // Seed from the trip being edited (or today's blank form) each time the sheet
  // opens, so a cancelled edit never leaks into the next one.
  useEffect(() => {
    if (!visible) return;
    setMode("form");
    setCanyonSearch("");
    setCustomTypes([]);
    setSaving(false);
    setDateKey(trip ? toDateKey(new Date(trip.date)) : todayDateKey());
    setSelected(
      trip ? trip.canyons.map((link) => ({ ...link })) : (initialCanyons ?? []),
    );
    setDisplayName(trip?.displayName ?? "");
    setTypes(trip?.types ?? []);
    setNotes(trip?.notes ?? "");
    setDateTarget({ kind: "trip" });
    setEditingField(null);
    setFieldValues(fieldValueStrings(trip?.customFields));
    // Deliberately keyed on the sheet OPENING, not on `initialCanyons`: callers
    // build that array inline, so a new identity every render would re-seed the
    // form under the user mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, visible]);

  // Linking a canyon means "I did that canyon", so the API force-tags
  // `canyoning` on save. Mirror that into the selection so the chip reads
  // SELECTED the moment a canyon is linked — and it is LOCKED (see
  // CANYONING_LOCKED) rather than toggleable, because the server re-adds it on
  // save anyway, so a chip the user could "deselect" would be a lie.
  // enforceCanyoningTag only ever force-ADDS, so unlinking the last canyon
  // leaves an existing `canyoning` alone (a canyon-less trip can still be
  // canyoning) — and with no canyon linked the chip is a normal toggle.
  const hasLinkedCanyon = selected.length > 0;
  useEffect(() => {
    setTypes((prev) => enforceCanyoningTag(prev, hasLinkedCanyon));
  }, [hasLinkedCanyon]);

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

  const toggleCanyon = useCallback(
    (canyon: MirrorCanyon) => {
      setSelected((current) => {
        if (current.some((link) => link.id === canyon.id)) {
          return current.filter((link) => link.id !== canyon.id);
        }
        if (current.length >= MAX_CANYONS_PER_TRIP) {
          onFailed(`A trip can have at most ${MAX_CANYONS_PER_TRIP} canyons.`);
          return current;
        }
        return [...current, { id: canyon.id, name: canyon.name }];
      });
    },
    [onFailed],
  );

  const save = useCallback(async () => {
    setSaving(true);
    const trimmedName = displayName.trim();
    const trimmedNotes = notes.trim();
    // The canyoning tag a linked canyon implies — applied here so the chips the
    // user just saw are exactly what the server will store (shared derivation).
    const effectiveTypes = enforceCanyoningTag(types, selected.length > 0);
    const isoDate = `${dateKey}T00:00:00.000Z`;
    const effectiveCustomFields = coerceCustomFields(fieldValues, customFieldDefs);
    try {
      if (trip) {
        // Field-scoped: push only what actually changed, so a concurrent edit
        // to another field on another device isn't clobbered (§6 LWW).
        const changes: Parameters<typeof updateTripLocal>[1] = {};
        if (isoDate !== new Date(trip.date).toISOString()) changes.date = isoDate;
        if ((trimmedName || null) !== trip.displayName) {
          changes.displayName = trimmedName || null;
        }
        if ((trimmedNotes || null) !== trip.notes) changes.notes = trimmedNotes || null;
        if (!sameOrder(effectiveTypes, trip.types)) changes.types = effectiveTypes;
        if (
          JSON.stringify(effectiveCustomFields) !== JSON.stringify(trip.customFields ?? {})
        ) {
          changes.customFields = effectiveCustomFields;
        }
        if (
          !sameOrder(
            selected.map((link) => link.id),
            trip.canyons.map((link) => link.id),
          )
        ) {
          changes.canyons = selected;
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
          canyons: selected,
        });
        onSaved("Trip logged.");
      }
      onClose();
    } catch (err) {
      // The message is ours, not the error's: an error string could carry a
      // canyon name into a toast (and from there a screenshot).
      console.error(err);
      onFailed("Couldn't save this trip.");
    } finally {
      setSaving(false);
    }
  }, [
    customFieldDefs,
    dateKey,
    displayName,
    fieldValues,
    notes,
    onClose,
    onFailed,
    onSaved,
    selected,
    trip,
    types,
  ]);

  const derivedTitle = formatTripCanyonNames(selected.map((link) => link.name));
  const title =
    mode === "date"
      ? dateTarget.kind === "trip"
        ? "Trip date"
        : (customFieldDefs.find((def) => def.key === dateTarget.key)?.label ?? "Date")
      : mode === "canyons"
        ? "Canyons on this trip"
        : mode === "fields"
          ? "Your trip fields"
          : mode === "fieldForm"
            ? (editingField ? "Edit field" : "New field")
            : editing
              ? "Edit trip"
              : "Log a trip";

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
      // Pinned, because the canyon list is longer than the sheet: a Done button
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
          // Its own body carries the save action; this is just the way back.
          <Button label="Cancel" variant="outlineAccent" onPress={() => setMode("fields")} />
        ) : (
          <Button
            label="Done"
            icon="check"
            onPress={() => setMode(mode === "fields" ? "form" : "form")}
          />
        )
      }
    >
      {mode === "date" ? (
        <View style={styles.modeBody}>
          <DatePicker
            value={dateTarget.kind === "trip" ? dateKey : (fieldValues[dateTarget.key] || null)}
            onChange={(key) => {
              if (dateTarget.kind === "trip") setDateKey(key);
              else setFieldValues((current) => ({ ...current, [dateTarget.key]: key }));
            }}
          />
        </View>
      ) : null}

      {mode === "fields" ? (
        <CustomFieldList
          entity="tripLog"
          online={online}
          defs={customFieldDefs}
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
          entity="tripLog"
          online={online}
          defs={customFieldDefs}
          editing={editingField}
          onSaved={(next, message) => {
            setCustomFieldDefs(next);
            onSaved(message);
          }}
          onFailed={onFailed}
          onDone={() => setMode("fields")}
        />
      ) : null}

      {mode === "canyons" ? (
        <CanyonPicker
          canyons={canyons}
          selected={selected}
          search={canyonSearch}
          onSearch={setCanyonSearch}
          onToggle={toggleCanyon}
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
            title={derivedTitle ?? "No canyons linked"}
            subtitle={
              selected.length === 1 ? "1 canyon" : `${selected.length} canyons`
            }
            titleNumberOfLines={2}
            right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
            onPress={() => setMode("canyons")}
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
            disabledValues={hasLinkedCanyon ? CANYONING_LOCKED : undefined}
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
            defs={customFieldDefs}
            values={fieldValues}
            onChange={(key, next) =>
              setFieldValues((current) => ({ ...current, [key]: next }))
            }
            onPickDate={(key) => {
              setDateTarget({ kind: "field", key });
              setMode("date");
            }}
          />

          {/* A guest's definitions are on this phone, so this door is open with
              no account and no signal. An account's list is shared with the web,
              which is the only case that needs a connection. */}
          <Row
            icon="sliders"
            title="Your trip fields"
            subtitle={
              fieldDefsBlockedReason(accountState, online) ??
              (customFieldDefs.length === 0
                ? "Add your own — water level, party size, anything"
                : `${customFieldDefs.length} field${customFieldDefs.length === 1 ? "" : "s"}`)
            }
            disabled={fieldDefsBlockedReason(accountState, online) !== undefined}
            right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
            onPress={() => setMode("fields")}
          />
        </View>
      ) : null}
    </BottomSheet>
  );
}

/** Order-sensitive comparison — a trip's canyon order drives its derived title. */
function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Searchable multi-select over the canyon library. Selected canyons pin to the
 * top in selection order, because that order is what the derived trip title
 * reads — "Claustral and Ranon" is a different title from "Ranon and Claustral".
 */
function CanyonPicker({
  canyons,
  selected,
  search,
  onSearch,
  onToggle,
}: {
  canyons: MirrorCanyon[];
  selected: TripCanyonLink[];
  search: string;
  onSearch: (next: string) => void;
  onToggle: (canyon: MirrorCanyon) => void;
}) {
  const selectedIds = new Set(selected.map((link) => link.id));
  const query = search.trim().toLowerCase();
  const matches = canyons.filter(
    (canyon) => !selectedIds.has(canyon.id) && canyon.name.toLowerCase().includes(query),
  );
  const pinned = selected
    .map((link) => canyons.find((canyon) => canyon.id === link.id))
    .filter((canyon): canyon is MirrorCanyon => canyon != null);

  return (
    <View style={styles.pickerBody}>
      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color={theme.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={onSearch}
          placeholder="Search your canyons"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel="Search your canyons"
          autoCapitalize="none"
        />
      </View>

      {pinned.length > 0 ? (
        <>
          <SectionHeader label={`On this trip · ${pinned.length}`} />
          {pinned.map((canyon, index) => (
            <Row
              key={canyon.id}
              icon="check"
              hue={theme.accent}
              title={canyon.name}
              subtitle={`${index + 1} of ${pinned.length}`}
              onPress={() => onToggle(canyon)}
              accessibilityLabel={`Remove ${canyon.name} from this trip`}
            />
          ))}
        </>
      ) : null}

      <SectionHeader label={query ? "Matches" : "Your canyons"} />
      {matches.length === 0 ? (
        <Text style={styles.hint}>
          {canyons.length === 0
            ? "No canyons saved on this device yet. You can log the trip now and link a canyon later."
            : "Nothing matches that name."}
        </Text>
      ) : (
        matches.map((canyon) => (
          <Row
            key={canyon.id}
            icon="plus"
            hue={theme.bonus1}
            title={canyon.name}
            onPress={() => onToggle(canyon)}
            accessibilityLabel={`Add ${canyon.name} to this trip`}
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
