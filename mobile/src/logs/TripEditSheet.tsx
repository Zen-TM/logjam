import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  enforceCanyoningTag,
  formatTripCanyonNames,
  MAX_CANYONS_PER_TRIP,
  TRIP_TYPE_SUGGESTIONS,
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
  type ChipOption,
} from "../ui";
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
type Mode = "form" | "date" | "canyons";

export function TripEditSheet({
  visible,
  onClose,
  trip,
  canyons,
  existingTypes,
  onSaved,
  onFailed,
}: {
  visible: boolean;
  onClose: () => void;
  /** null/undefined = log a new trip. */
  trip?: MirrorTrip | null;
  canyons: MirrorCanyon[];
  /** Types across the user's own history, unioned with the seed vocabulary. */
  existingTypes: string[];
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
}) {
  const editing = trip != null;
  const [mode, setMode] = useState<Mode>("form");
  const [dateKey, setDateKey] = useState(() => toDateKey(new Date()));
  const [selected, setSelected] = useState<TripCanyonLink[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [canyonSearch, setCanyonSearch] = useState("");

  // Seed from the trip being edited (or today's blank form) each time the sheet
  // opens, so a cancelled edit never leaks into the next one.
  useEffect(() => {
    if (!visible) return;
    setMode("form");
    setCanyonSearch("");
    setCustomTypes([]);
    setSaving(false);
    setDateKey(trip ? toDateKey(new Date(trip.date)) : toDateKey(new Date()));
    setSelected(trip ? trip.canyons.map((link) => ({ ...link })) : []);
    setDisplayName(trip?.displayName ?? "");
    setTypes(trip?.types ?? []);
    setNotes(trip?.notes ?? "");
  }, [trip, visible]);

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
          onFailed(`A trip can link at most ${MAX_CANYONS_PER_TRIP} canyons.`);
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
          canyons: selected,
        });
        onSaved("Trip logged.");
      }
      onClose();
    } catch (err) {
      // The message is ours, not the error's: an error string could carry a
      // canyon name into a toast (and from there a screenshot).
      console.error(err);
      onFailed("Couldn't save this trip. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [dateKey, displayName, notes, onClose, onFailed, onSaved, selected, trip, types]);

  const derivedTitle = formatTripCanyonNames(selected.map((link) => link.name));
  const title =
    mode === "date"
      ? "Trip date"
      : mode === "canyons"
        ? "Canyons on this trip"
        : editing
          ? "Edit trip"
          : "Log a trip";

  return (
    <BottomSheet
      visible={visible}
      // Inside a sub-mode, a drag or a backdrop tap means "back to the form" —
      // not "throw away everything I just typed".
      onClose={mode === "form" ? onClose : () => setMode("form")}
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
        ) : (
          <Button label="Done" icon="check" onPress={() => setMode("form")} />
        )
      }
    >
      {mode === "date" ? (
        <View style={styles.modeBody}>
          <DatePicker value={dateKey} onChange={setDateKey} />
        </View>
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
              subtitle={`${index + 1} of ${pinned.length} in the title`}
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
            ? "No canyons synced to this device yet. You can log the trip without one and link it later."
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
