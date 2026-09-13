// Managing your own PLACE TYPES on the phone.
//
// The type is the thing that decides which questions a place is asked, what
// colour its pin is and which tab it lands under — and until now it could only
// be created on the web. The sync push has accepted `placeType`
// create/update/delete since the rework (`PLACE_TYPE_FIELDS` in
// api/src/routes/sync.ts); the phone simply had no screen for it, so a user
// with only a phone could not add one at all.
//
// The LIST lives in Settings, beside the two attribute lists, for the same
// reason they do: it is a list you keep rather than a preference you set, and
// it is the same answer for trips and places. The FORM is also reachable from
// the Places tab's type rail, as a chip at the end of it — the rail is a
// filter, but it is also the only place in the app where a user is looking at
// their own types and thinking about them, and "there is no tab for the thing I
// want" is exactly the moment to offer one. The chip is an action, never a
// filter state: it opens this form and leaves the selection alone.
//
// Offline like everything else the user makes: rows go into the local mirror
// through the outbox, so adding a type standing at a trailhead works.
//
// SYSTEM TYPES GET NO VERBS, the same way a built-in attribute gets none. They
// belong to no account, the server answers 404 on a rename and 403 on a delete,
// and the phone's half of a delete would run first and for real.
//
// PRIVACY: a type name is user-authored ("Rap-in only", "Mate's place"), so it
// is as sensitive as a note. Nothing here logs one.
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  PLACE_TYPE_COLORS,
  PLACE_TYPE_ICON_KEYS,
  type PlaceTypeIconKey,
} from "@logjam/shared";

import { fontSize, radius, spacing, surface, theme } from "../theme";
import type { MirrorPlaceType } from "../sync/mirrorStore";
import { listMirrorPlaces } from "../sync/mirrorStore";
import {
  createPlaceTypeLocal,
  deletePlaceTypeLocal,
  updatePlaceTypeLocal,
} from "../sync/outbox";
import { Button, ErrorBanner, Row, SectionHeader, TextField } from "../ui";
import { placeTypeFeatherIcon } from "./placeTypeIcon";

/** A type nobody owns is a built-in: not renameable, not deletable. Same rule
 *  and same reason as `isSystemFieldDef`, on the other system vocabulary. */
export function isSystemPlaceType(type: MirrorPlaceType): boolean {
  return type.ownerId === null;
}

export function PlaceTypeList({
  types,
  onEdit,
}: {
  types: MirrorPlaceType[];
  onEdit: (type: MirrorPlaceType) => void;
}) {
  // BUILT-INS LAST, the same way the attribute list orders itself: the user's
  // own types are the half with verbs on them, and the three that ship with the
  // app are a footnote to that. Note this is the EDITOR's order only — the
  // Places tab's rail and `GET /place-types` still put the system types first,
  // because there the leftmost tab and the default type for a new place are
  // decided by that order.
  const ordered = [
    ...types.filter((type) => !isSystemPlaceType(type)),
    ...types.filter(isSystemPlaceType),
  ];
  return (
    <View style={styles.body}>
      <SectionHeader label={`${ordered.length} type${ordered.length === 1 ? "" : "s"}`} />
      {ordered.map((type) =>
        isSystemPlaceType(type) ? (
          <Row
            key={type.id}
            icon={placeTypeFeatherIcon(type.iconKey)}
            hue={type.color}
            title={type.name}
            subtitle="Built in"
          />
        ) : (
          <Row
            key={type.id}
            icon={placeTypeFeatherIcon(type.iconKey)}
            hue={type.color}
            title={type.name}
            onPress={() => onEdit(type)}
          />
        ),
      )}
    </View>
  );
}

/**
 * Add or change one type — a body and a pinned footer, like
 * `useCustomFieldForm` and for the same reason: the icon grid is tall enough
 * that a save button inside the scroll would not be on screen.
 */
export function usePlaceTypeForm({
  editing,
  onSaved,
  onDone,
}: {
  /** null = adding. */
  editing: MirrorPlaceType | null;
  onSaved: (message: string) => void;
  onDone: () => void;
}): { body: ReactNode; footer: ReactNode } {
  const formKey = editing?.id ?? "__new__";
  const [draft, setDraft] = useState(() => seedDraft(editing));
  const [seededFor, setSeededFor] = useState(formKey);
  if (seededFor !== formKey) {
    setSeededFor(formKey);
    setDraft(seedDraft(editing));
  }
  const [saving, setSaving] = useState(false);
  // The name check (attributed to the Name field) and a save/delete failure
  // (attributable to no single control, so it is the footer's `ErrorBanner`)
  // are different problems and render in different places — conflating them
  // into one state would put "Couldn't save that type on this phone." under
  // the Name label.
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { cellSize, onGridLayout } = useGridCellSize();

  const save = useCallback(async () => {
    const name = draft.name.trim();
    if (!name) {
      setError("A type needs a name.");
      return;
    }
    setError(null);
    setFormError(null);
    setSaving(true);
    try {
      if (editing) {
        // Field-scoped, so a rename on this phone does not clobber a recolour
        // made on another one.
        const changes: Record<string, unknown> = {};
        if (name !== editing.name) changes.name = name;
        if (draft.iconKey !== editing.iconKey) changes.iconKey = draft.iconKey;
        if (draft.color !== editing.color) changes.color = draft.color;
        if (Object.keys(changes).length > 0) {
          await updatePlaceTypeLocal(editing.id, changes);
        }
        onSaved("Type updated.");
      } else {
        await createPlaceTypeLocal({ name, iconKey: draft.iconKey, color: draft.color });
        onSaved("Type added.");
      }
      onDone();
    } catch (err) {
      console.error(err);
      // The sheet is still open here (onDone only runs on success) — a toast
      // would render under it and never be seen (DESIGN.md §8), so this is the
      // footer's banner, not a toast. A local write, so this is a broken
      // database rather than a missing connection — do not offer a network
      // explanation for something reconnecting cannot fix.
      setFormError("Couldn't save that type on this phone.");
    } finally {
      setSaving(false);
    }
  }, [draft, editing, onDone, onSaved]);

  const confirmDelete = useCallback(() => {
    if (!editing) return;
    // THE SERVER REFUSES A TYPE THAT STILL HAS PLACES ON IT (409, "Move them to
    // another type first"), so the count is taken here and the delete is
    // refused here. Queuing it anyway would park a dead push whose reason the
    // user never sees — the same rule the place form follows by validating
    // before it enqueues.
    listMirrorPlaces()
      .then((places) => {
        const inUse = places.filter((place) => place.placeTypeId === editing.id).length;
        if (inUse > 0) {
          Alert.alert(
            `“${editing.name}” is still in use`,
            `${inUse} place${inUse === 1 ? "" : "s"} ${inUse === 1 ? "is" : "are"} this type. Change ${inUse === 1 ? "it" : "them"} to another type first.`,
          );
          return;
        }
        Alert.alert(
          `Delete “${editing.name}”?`,
          "This can't be undone.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => {
                deletePlaceTypeLocal(editing.id)
                  .then(() => {
                    onSaved("Type deleted.");
                    onDone();
                  })
                  .catch((err: unknown) => {
                    console.error(err);
                    // Same reasoning as `save`'s catch: the sheet is still up,
                    // so this is the banner, not a toast under it.
                    setFormError("Couldn't delete that type.");
                  });
              },
            },
          ],
        );
      })
      .catch((err: unknown) => {
        console.error(err);
        setFormError("Couldn't check which places use this type.");
      });
  }, [editing, onDone, onSaved]);

  const body = (
    <View style={styles.body}>
      <TextField
        label="Name"
        value={draft.name}
        onChangeText={(next) => {
          setDraft((current) => ({ ...current, name: next }));
          // The empty-name requirement is checked on Save (DESIGN.md §8); once
          // shown it clears the moment the field it's about is edited.
          if (error) setError(null);
        }}
        error={error}
        autoCapitalize="sentences"
      />

      {/* CURATED, not free entry, on both axes — an icon key has to resolve in
          two different icon sets, and a marker colour carries a WCAG guarantee
          that can only be asserted over a closed set (`scripts/wcag-contrast.mjs`).
          A hex picker would not fail that check, it would delete it. */}
      <SectionHeader label="Icon" />
      <View style={styles.grid} onLayout={onGridLayout}>
        {/* Nothing until the row has been measured — one frame, and the
            alternative is every cell flashing at its intrinsic size first. */}
        {cellSize == null ? null : PLACE_TYPE_ICON_KEYS.map((iconKey) => (
          <Pressable
            key={iconKey}
            accessibilityRole="button"
            accessibilityLabel={iconKey}
            accessibilityState={{ selected: draft.iconKey === iconKey }}
            onPress={() => setDraft((current) => ({ ...current, iconKey }))}
            style={[
              styles.cell,
              cellSize,
              draft.iconKey === iconKey ? styles.cellChosen : null,
            ]}
          >
            <Feather
              name={placeTypeFeatherIcon(iconKey)}
              size={20}
              color={draft.iconKey === iconKey ? theme.accent : theme.textPrimary}
            />
          </Pressable>
        ))}
      </View>

      <SectionHeader label="Colour" />
      <View style={styles.grid} onLayout={onGridLayout}>
        {cellSize == null ? null : PLACE_TYPE_COLORS.map((color) => (
          <Pressable
            key={color}
            accessibilityRole="button"
            accessibilityLabel={color}
            accessibilityState={{ selected: draft.color === color }}
            onPress={() => setDraft((current) => ({ ...current, color }))}
            style={[
              styles.cell,
              styles.swatch,
              cellSize,
              { backgroundColor: color },
              draft.color === color ? styles.cellChosen : null,
            ]}
          >
            {draft.color === color ? (
              // Dark ink on a light swatch: the palette is light precisely so a
              // mark on top of it stays legible.
              <Feather name="check" size={16} color={theme.primary} />
            ) : null}
          </Pressable>
        ))}
      </View>

      <Text style={styles.hint}>
        A ring around a pin means the place was shared with you by a friend.
      </Text>

      {editing ? (
        <Row icon="trash-2" hue={theme.warning} title="Delete type" onPress={confirmDelete} />
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {/* Not attributable to one control (a local write failing, or the
          places-in-use check itself failing) — the banner sits directly above
          Save, same as every other form (DESIGN.md §8). */}
      {formError ? <ErrorBanner message={formError} /> : null}
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button label="Cancel" variant="outlineAccent" onPress={onDone} />
        </View>
        <View style={styles.action}>
          <Button
            label={editing ? "Save" : "Add type"}
            icon="check"
            loading={saving}
            onPress={() => void save()}
          />
        </View>
      </View>
    </View>
  );

  return { body, footer };
}

/** Cells per row. Both grids use the same count so the two blocks line up with
 *  each other as well as with the name field above them. */
const GRID_COLUMNS = 6;

/**
 * Cell width MEASURED from the row, not fixed.
 *
 * A grid of fixed 44pt cells leaves whatever the row width happens not to
 * divide into as a ragged margin down the right-hand side, so a full row of
 * icons sat inset from the edge the name field reached — which reads as a
 * misalignment rather than as a grid. Measuring once and dividing makes a full
 * row exactly as wide as every other control on the form.
 *
 * Null until the first layout: a cell with no width would flash at its
 * intrinsic size, so the grid renders nothing rather than the wrong thing.
 */
function useGridCellSize(): {
  cellSize: { width: number; height: number } | null;
  onGridLayout: (event: LayoutChangeEvent) => void;
} {
  const [width, setWidth] = useState<number | null>(null);
  const size =
    width == null
      ? null
      : Math.floor((width - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  return {
    cellSize: size == null ? null : { width: size, height: size },
    onGridLayout: (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
  };
}

type PlaceTypeDraft = { name: string; iconKey: PlaceTypeIconKey; color: string };

/** A NEW type starts on the neutral pin and the first palette entry rather than
 *  on nothing: a form whose preview is blank until two more taps reads as
 *  broken, and both defaults are valid answers. */
function seedDraft(editing: MirrorPlaceType | null): PlaceTypeDraft {
  return {
    name: editing?.name ?? "",
    iconKey: (editing?.iconKey as PlaceTypeIconKey) ?? PLACE_TYPE_ICON_KEYS[0],
    color: editing?.color ?? PLACE_TYPE_COLORS[0],
  };
}

const GRID_GAP = spacing(1);

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  footer: { gap: spacing(1) },
  actions: { flexDirection: "row", gap: spacing(1) },
  action: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  cell: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: surface.border,
    alignItems: "center",
    justifyContent: "center",
  },
  swatch: { borderColor: "transparent" },
  cellChosen: { borderWidth: 2, borderColor: theme.accent },
  hint: { color: theme.textMuted, fontSize: fontSize.sm },
});
