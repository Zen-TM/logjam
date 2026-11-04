import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Text, View, type TextInputInstance } from "react-native";
import {
  abandonConfirm,
  ADD_WAY,
  ATTRIBUTE_NOUN,
  contractSectionKeys,
  defsForType,
  isValidLatitude,
  isValidLongitude,
  mediaCategory,
  placeAttributesTitle,
  PLACE_FORM,
  type SectionKeysOn,
  setFieldValues as withFieldValues,
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPE_IDS,
  userFieldValues,
  validatePlacePayload,
  type ScopedCustomFieldDef,
  coordinateEntry,
} from "@logjam/shared";

import { spacing, makeStyles, useTheme, useHues, muted } from "../theme";
import {
  coordinateBlur,
  coordinateProblem,
  coordinateText,
  coordinateValue,
  seedCoord,
  shownCoord,
} from "./coordinateText";
import type { MirrorPlace } from "../sync/mirrorStore";
import { createPlaceLocal, updatePlaceLocal } from "../sync/outbox";
import { attachMediaLocal } from "../sync/mediaUpload";
import { pickMedia } from "../media/pickMedia";
import { AddWaySheet } from "./AddWaySheet";
import {
  hasStagedMedia,
  NO_STAGED_MEDIA,
  queueStagedMedia,
  type StagedMedia,
} from "./stagedPlaceMedia";
import {
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
import { placeTypeGlyph } from "./placeTypeIcon";
import {
  BottomSheet,
  Button,
  DatePicker,
  ErrorBanner,
  Field,
  FormStack,
  IconButton,
  Row,
  SectionHeader,
  ChipRail,
  TextField,
  type ChipOption,
  Icon,
} from "../ui";

/**
 * Add or edit a place — one sheet for both (DESIGN.md). The fields are
 * identical; only the title, the submit label and whether coordinates arrive
 * pre-filled differ.
 *
 * Both paths queue through the outbox, so adding a place standing at its
 * entrance with no signal works exactly like adding one at home.
 *
 * Coordinates are typed, or seeded by the caller from a point pressed on the map or
 * the map's centre (`initialCoords`). They are never captured from GPS *here*: a permission window
 * cannot be raised from an open sheet (DESIGN.md — the bug that made "Take
 * photo" look dead), so any future fix-based entry belongs in the caller too.
 *
 * The user's own fields are edited here too, and their definitions are reached
 * through a MODE of this sheet, exactly as on `TripEditSheet` (DESIGN.md —
 * never a second modal). A date-typed field needs the picker, which is the
 * other mode.
 *
 * A NEW place also takes photos, videos and a way (the place page's own
 * entries). They are only held here until Save, then queued behind the place's
 * create, so cancelling leaves nothing queued (`stagedPlaceMedia.test.ts`). A
 * system picker cannot run under an open sheet (DESIGN.md §4), so while one of
 * their sheets is up this form steps out of the way, state intact, like the
 * map picker's `resuming` round trip.
 *
 * PRIVACY: a place's name and position are the most sensitive pair in the app.
 * They live in component state and leave only through the outbox's authed push;
 * nothing here is logged, and the failure copy is ours rather than the error's.
 */
type FormValues = {
  name: string;
  altNames: string;
  latitude: string;
  longitude: string;
  notes: string;
  placeTypeId: string;
  fieldValues: Record<string, string>;
};

/** An emptied field is the same as one never filled, so it is left out. */
const formFingerprint = (values: FormValues) =>
  JSON.stringify({
    ...values,
    fieldValues: Object.entries(values.fieldValues)
      .filter(([, value]) => value !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  });

/** The sheet's sub-screens. Modes, never a second sheet (DESIGN.md). */
type Mode = "form" | "date" | "fields" | "fieldForm";

export function PlaceEditSheet({
  visible,
  onClose,
  place,
  initialCoords,
  onPickOnMap,
  pickedCoords,
  resuming = false,
  focusName = false,
  onSaved,
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
  onPickOnMap?: (
    current: { latitude: number; longitude: number } | null,
  ) => void;
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
   * intact; this flag is only what stops the seed from wiping it.
   */
  resuming?: boolean;
  /** Opens with the keyboard on Name: the one thing a quick drop left out. */
  focusName?: boolean;
  onSaved: (message: string) => void;
}) {
  const theme = useTheme();
  const { assetHue } = useHues();
  const styles = useStyles();

  const editing = place != null;
  const nameRef = useRef<TextInputInstance>(null);
  useEffect(() => {
    if (!visible || !focusName) return;
    // `autoFocus` fails in a modal that is still sliding in (TextField), so
    // focus once it has settled.
    const timer = setTimeout(() => nameRef.current?.focus(), 400);
    return () => clearTimeout(timer);
  }, [visible, focusName]);
  const [name, setName] = useState("");
  const [altNames, setAltNames] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  // Only a field the user has typed in (or a picked point filled) writes; the
  // others follow the place's stored value (`coordinateText`).
  const [latitudeEdited, setLatitudeEdited] = useState(false);
  const [longitudeEdited, setLongitudeEdited] = useState(false);
  const [notes, setNotes] = useState("");
  const [placeTypeId, setPlaceTypeId] = useState<string>(
    SYSTEM_PLACE_TYPE_IDS.canyon,
  );
  // Attributed to their own control (shared/DESIGN.md §11): the name check and
  // `validatePlacePayload`'s coordinate messages ("Latitude must be…",
  // "Longitude must be…") each go under the field they're about. Everything
  // else — a field-value range, a save the outbox rejected — belongs to no
  // single control and is `formError`, the banner above Save.
  const [nameError, setNameError] = useState<string | null>(null);
  const [latitudeError, setLatitudeError] = useState<string | null>(null);
  const [longitudeError, setLongitudeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>("form");
  // New place only: the photos and way picked so far, the sheet that picks them,
  // and whether this form is out of its way. `away` outlasts the picking sheet
  // (it clears on that sheet's `onClosed`, after any system picker it parked).
  const [staged, setStaged] = useState<StagedMedia>(NO_STAGED_MEDIA);
  const [pickSheet, setPickSheet] = useState<"photos" | "way" | null>(null);
  const [away, setAway] = useState(false);
  const [pickJob, setPickJob] = useState<null | (() => Promise<void>)>(null);
  const { defs: customFieldDefs, setDefs: setCustomFieldDefs } =
    useFieldDefs("place");
  const placeTypes = useMirrorPlaceTypes();
  // Values are strings while editing and coerced on save, like every other
  // custom-field form.
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [dateFieldKey, setDateFieldKey] = useState<string | null>(null);
  // The form as seeded, to tell an edit from an untouched sheet (§10).
  const [pristine, setPristine] = useState("");
  const [editingField, setEditingField] = useState<ScopedCustomFieldDef | null>(
    null,
  );

  // Seed each time the sheet opens, so a cancelled edit never leaks into the
  // next one. Keyed on the place's ID, not the object: a detail screen hands
  // this a fresh object on every mirror change (a sync pull, an upload tick),
  // and re-seeding on that wiped whatever the user was halfway through typing.
  // `resuming` is NOT in the key: it and `visible` flip in the same commit, and
  // keying on it would re-run the seed the moment the parent cleared the flag
  // afterwards — which is the wipe this exists to stop.
  const seedKey = { placeId: place?.id, initialCoords, visible };
  const [seededFor, setSeededFor] = useState<typeof seedKey | null>(null);
  if (
    seededFor === null ||
    seededFor.placeId !== seedKey.placeId ||
    seededFor.initialCoords !== seedKey.initialCoords ||
    seededFor.visible !== seedKey.visible
  ) {
    setSeededFor(seedKey);
    if (visible && !resuming) seed();
  }

  function seed() {
    setNameError(null);
    setLatitudeError(null);
    setLongitudeError(null);
    setFormError(null);
    setSaving(false);
    const start: FormValues = {
      name: place?.name ?? "",
      altNames: (place?.altNames ?? []).join(", "),
      // An existing place shows its position as its page does, to five places;
      // `coordinate` hands the stored value back unless the user typed over it.
      // A freshly picked point is trimmed too, because a map press carries
      // fifteen meaningless decimals.
      latitude: place
        ? shownCoord(place.latitude)
        : seedCoord(initialCoords?.latitude),
      longitude: place
        ? shownCoord(place.longitude)
        : seedCoord(initialCoords?.longitude),
      notes: place?.notes ?? "",
      // A new place starts as a CANYON: this is a canyoning app, and a default
      // that is right most of the time beats a picker with nothing chosen. The
      // rail is right there to say otherwise.
      placeTypeId: place?.placeTypeId ?? SYSTEM_PLACE_TYPE_IDS.canyon,
      // The grades are ordinary field values, seeded by the one path every
      // other field uses.
      fieldValues: fieldValueStrings(userFieldValues(place?.fieldValues)),
    };
    setName(start.name);
    setAltNames(start.altNames);
    setLatitude(start.latitude);
    setLongitude(start.longitude);
    setLatitudeEdited(false);
    setLongitudeEdited(false);
    setNotes(start.notes);
    setPlaceTypeId(start.placeTypeId);
    setFieldValues(start.fieldValues);
    setPristine(formFingerprint(start));
    setMode("form");
    setEditingField(null);
    setDateFieldKey(null);
    setStaged(NO_STAGED_MEDIA);
    setPickSheet(null);
    setAway(false);
    setPickJob(null);
  }

  function stepOutTo(sheet: "photos" | "way") {
    setAway(true);
    setPickSheet(sheet);
  }

  /** Close the photo sheet, then run the picker with nothing on screen. */
  function pickFrom(source: "camera" | "library", kind: "photo" | "video") {
    setPickJob(() => async () => {
      const files = await pickMedia(source, kind);
      if (files.length > 0)
        setStaged((current) => ({
          ...current,
          files: [...current.files, ...files],
        }));
    });
    setPickSheet(null);
  }

  function photoSheetClosed() {
    const job = pickJob;
    setPickJob(null);
    if (!job) {
      setAway(false);
      return;
    }
    void job()
      .catch((err: unknown) => {
        console.error(err);
        setFormError(PLACE_FORM.copy.pickFailed);
      })
      .finally(() => setAway(false));
  }

  // A point back from the picker touches the two coordinate fields and nothing
  // else — everything else on this form is what the user was in the middle of
  // typing. Trimmed like any freshly picked point: a map tap carries fifteen
  // meaningless decimals.
  const [appliedPick, setAppliedPick] = useState<typeof pickedCoords>(null);
  if (pickedCoords !== appliedPick) {
    setAppliedPick(pickedCoords);
    if (pickedCoords) {
      setLatitude(seedCoord(pickedCoords.latitude));
      setLongitude(seedCoord(pickedCoords.longitude));
      setLatitudeEdited(true);
      setLongitudeEdited(true);
      setLatitudeError(null);
      setLongitudeError(null);
    }
  }

  /** Every type is offered here, including the empty ones — the list hides a
   *  type with no places, but you have to be able to make the first one. */
  const typeOptions: ChipOption<string>[] = useMemo(
    () =>
      (placeTypes.data ?? []).map((type) => ({
        value: type.id,
        label: type.name,
        icon: placeTypeGlyph(type.iconKey),
        hue: type.color,
      })),
    [placeTypes.data],
  );

  /**
   * The fields THIS type's form asks for — ALL of them, with nothing cut.
   *
   * Canyon axes are ordinary bounded field values with definitions rendered
   * by the generic renderer: a bounded integer is a rail
   * (`CustomFieldValues.tsx`), by rule instead of by name. A canyon's own
   * fields appear in "Your place attributes"; `quality` is a FLOAT and gets a
   * decimal box rather than a rail that cannot express the 4.5 Logjam Web
   * stores; and a user's own "Difficulty, 1-5" is drawn like a V grade without
   * anything knowing about canyons.
   */
  const typeFieldDefs = useMemo(
    () => defsForType(customFieldDefs, placeTypeId),
    [customFieldDefs, placeTypeId],
  );

  const latitudeShown = coordinateText(
    latitude,
    latitudeEdited,
    place?.latitude,
  );
  const longitudeShown = coordinateText(
    longitude,
    longitudeEdited,
    place?.longitude,
  );

  /** The form in the shape both the validator and the ops speak. */
  const draft = useMemo(
    () => ({
      name: name.trim(),
      altNames: altNames
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
      latitude: coordinateValue(latitude, latitudeEdited, place?.latitude),
      longitude: coordinateValue(longitude, longitudeEdited, place?.longitude),
      notes: notes.trim() || null,
    }),
    [
      altNames,
      latitude,
      latitudeEdited,
      longitude,
      longitudeEdited,
      name,
      notes,
      place,
    ],
  );

  const save = useCallback(async () => {
    setNameError(null);
    setLatitudeError(null);
    setLongitudeError(null);
    setFormError(null);
    const effectiveCustomFields = coerceCustomFields(
      fieldValues,
      typeFieldDefs,
    );
    // Every check runs, so one press lights every bad field. The coordinates
    // are required on an edit too, as on Logjam Web.
    const nameProblem = draft.name === "" ? PLACE_FORM.copy.nameMissing : null;
    const latitudeProblem = coordinateProblem(
      latitudeShown,
      draft.latitude,
      isValidLatitude,
      PLACE_FORM.copy.latitudeMissing,
      PLACE_FORM.copy.latitudeInvalid,
    );
    const longitudeProblem = coordinateProblem(
      longitudeShown,
      draft.longitude,
      isValidLongitude,
      PLACE_FORM.copy.longitudeMissing,
      PLACE_FORM.copy.longitudeInvalid,
    );
    // The same predicate the API applies, run before anything is queued: a
    // rejected op would otherwise sit in the outbox as a dead push whose reason
    // the user never sees. The coordinates are checked above, so only a valid
    // one is handed over.
    const fieldProblem = validatePlacePayload(
      {
        // Cleared fields are dropped for the CHECK: `coerceCustomFields` writes
        // an explicit null so the merge below can remove the key, and the
        // validator must not be handed a null for a field simply not recorded.
        fieldValues: withoutClearedFields(effectiveCustomFields),
        ...(isValidLatitude(draft.latitude) && { latitude: draft.latitude }),
        ...(isValidLongitude(draft.longitude) && {
          longitude: draft.longitude,
        }),
      },
      // The bounds come from the DEFINITIONS — the system ones (compiled in,
      // so the check works with no signal) AND the ones this type actually
      // renders. Checking only the system defs left every user field
      // unvalidated on the client: an out-of-range value queued, the server
      // refused it, and it parked as a sync issue — exactly the outcome this
      // check exists to prevent.
      {
        requireCoords: false,
        defs: [...SYSTEM_FIELD_DEFS, ...typeFieldDefs],
      },
    );
    setNameError(nameProblem);
    setLatitudeError(latitudeProblem);
    setLongitudeError(longitudeProblem);
    if (nameProblem || latitudeProblem || longitudeProblem) {
      setFormError(PLACE_FORM.copy.fixFields);
      return;
    }
    if (fieldProblem) {
      // A field-value range belongs to no single control, so it is the banner.
      setFormError(fieldProblem);
      return;
    }

    setSaving(true);
    try {
      if (place) {
        // Field-scoped: push only what changed, so a concurrent edit to another
        // field on another device isn't clobbered (§6 LWW).
        const changes: Record<string, unknown> = {};
        if (draft.name !== place.name) changes.name = draft.name;
        if (!sameList(draft.altNames, place.altNames))
          changes.altNames = draft.altNames;
        if (draft.latitude != null && draft.latitude !== place.latitude) {
          changes.latitude = draft.latitude;
        }
        if (draft.longitude != null && draft.longitude !== place.longitude) {
          changes.longitude = draft.longitude;
        }
        if (draft.notes !== place.notes) changes.notes = draft.notes;
        if (placeTypeId !== place.placeTypeId)
          changes.placeTypeId = placeTypeId;
        // `fieldValues` is replaced wholesale by the server, so the edit is
        // built OVER the place's existing values — `_sources`, which only the
        // web writes, and any key another client added would otherwise be
        // dropped by an edit made on the phone.
        // Built OVER the stored values, never rebuilt from the form: that is
        // what keeps `_sources`, another client's key, and — on a type change —
        // the OLD type's values, which the server needs in the payload to park
        // them in `foreignFields` rather than lose them (§2.6).
        const nextValues = withFieldValues(
          place.fieldValues,
          effectiveCustomFields,
        );
        if (!sameFieldValues(nextValues, place.fieldValues ?? {})) {
          changes.fieldValues = nextValues;
        }
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        await updatePlaceLocal(place.id, changes);
        onSaved(PLACE_FORM.copy.saved);
      } else {
        const newId = await createPlaceLocal({
          name: draft.name,
          // Non-null by the validation above.
          latitude: draft.latitude as number,
          longitude: draft.longitude as number,
          altNames: draft.altNames,
          notes: draft.notes,
          placeTypeId,
          fieldValues: withFieldValues({}, effectiveCustomFields),
        });
        // After the place's own create, so each waits behind it in the outbox.
        const { failed } = await queueStagedMedia(newId, staged, (file) =>
          attachMediaLocal("place", newId, file),
        );
        onSaved(failed ? PLACE_FORM.copy.addedNotAll : PLACE_FORM.copy.added);
      }
      onClose();
    } catch (err) {
      console.error(err);
      // The sheet is still open here — onClose() only runs on success — so a
      // toast would render under it and never be seen (shared/DESIGN.md §11). The
      // banner above Save is what reports it.
      setFormError(PLACE_FORM.copy.saveFailed);
    } finally {
      setSaving(false);
    }
  }, [
    place,
    draft,
    fieldValues,
    onClose,
    onSaved,
    latitudeShown,
    longitudeShown,
    placeTypeId,
    staged,
    typeFieldDefs,
  ]);

  const fieldForm = useCustomFieldForm({
    open: mode === "fieldForm",
    entity: "place",
    defs: customFieldDefs,
    editing: editingField,
    // Opened from a place's own form, so the type it is on is the default —
    // and still changeable, keeping the form reached from a place as capable
    // as the identical form in Settings.
    initialTypeId: placeTypeId,
    onSaved: (next, message) => {
      setCustomFieldDefs(next);
      onSaved(message);
    },
    onDone: () => setMode("fields"),
  });

  const title =
    mode === "date"
      ? (customFieldDefs.find((def) => def.key === dateFieldKey)?.label ??
        "Date")
      : mode === "fields"
        ? `Your place ${ATTRIBUTE_NOUN.many}`
        : mode === "fieldForm"
          ? editingField
            ? editingField.label
            : `New place ${ATTRIBUTE_NOUN.one}`
          : editing
            ? PLACE_FORM.copy.editTitle
            : PLACE_FORM.copy.addTitle;

  const dirty =
    mode === "form" &&
    (formFingerprint({
      name,
      altNames,
      latitude,
      longitude,
      notes,
      placeTypeId,
      fieldValues,
    }) !== pristine ||
      hasStagedMedia(staged));

  const sections: Record<SectionKeysOn<typeof PLACE_FORM, "gps">, ReactNode> = {
    // The two below are for a NEW place only: an existing one has both on its
    // page, one tap from here, with the real strip.
    photos: editing ? null : (
      <>
        <SectionHeader title={PLACE_FORM.copy.photos} />
        {staged.files.map((file, index) => {
          const video =
            mediaCategory(file.mimeType ?? "image/jpeg") === "video";
          const title = file.fileName ?? (video ? "Video" : "Photo");
          return (
            <Row
              key={`${file.uri}-${index}`}
              icon={video ? "video" : "photo"}
              title={title}
              subtitle={PLACE_FORM.copy.stagedHint}
              right={
                <IconButton
                  icon="close"
                  accessibilityLabel={`Remove ${title}`}
                  onPress={() =>
                    setStaged((current) => ({
                      ...current,
                      files: current.files.filter((_, at) => at !== index),
                    }))
                  }
                />
              }
            />
          );
        })}
        <Button
          label="Add a photo or video"
          icon="add"
          variant="outlineAccent"
          onPress={() => stepOutTo("photos")}
        />
      </>
    ),
    route: editing ? null : (
      <>
        <SectionHeader title={PLACE_FORM.copy.route} />
        {staged.way ? (
          <Row
            icon="route"
            hue={assetHue.route}
            title={staged.way.label}
            subtitle={PLACE_FORM.copy.stagedHint}
            right={
              <IconButton
                icon="close"
                accessibilityLabel={`Remove ${staged.way.label}`}
                onPress={() =>
                  setStaged((current) => ({ ...current, way: null }))
                }
              />
            }
          />
        ) : null}
        <Button
          label={staged.way ? ADD_WAY.copy.replaceTitle : ADD_WAY.copy.title}
          icon={staged.way ? "replace" : "add"}
          variant="outlineAccent"
          onPress={() => stepOutTo("way")}
        />
      </>
    ),
    type: (
      <>
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
          <Field label={PLACE_FORM.copy.type}>
            <ChipRail
              scroll
              options={typeOptions}
              value={placeTypeId}
              onChange={setPlaceTypeId}
            />
          </Field>
        ) : null}
      </>
    ),
    name: (
      <>
        <TextField
          label={PLACE_FORM.copy.name}
          requiredMark
          reserveError
          value={name}
          onChangeText={(next) => {
            setName(next);
            if (nameError) setNameError(null);
          }}
          error={nameError}
          autoCapitalize="words"
          inputRef={nameRef}
        />
      </>
    ),
    alsoKnownAs: (
      <>
        <TextField
          label={PLACE_FORM.copy.alsoKnownAs}
          value={altNames}
          onChangeText={setAltNames}
          autoCapitalize="words"
          hint={PLACE_FORM.copy.alsoKnownAsHint}
        />
      </>
    ),
    position: (
      <>
        <SectionHeader title={PLACE_FORM.copy.position} />
        <View style={styles.coordRow}>
          <View style={styles.coordField}>
            <TextField
              label={PLACE_FORM.copy.latitude}
              requiredMark
              reserveError
              value={latitudeShown}
              onChangeText={(next) => {
                const entry = coordinateEntry(next, "latitude", latitudeShown);
                setLatitude((was) => entry.latitude ?? was);
                setLongitude((was) => entry.longitude ?? was);
                setLatitudeEdited(true);
                // A pair fills both, so neither keeps its old error.
                if (
                  entry.latitude !== undefined &&
                  entry.longitude !== undefined
                ) {
                  setLatitudeEdited(true);
                  setLongitudeEdited(true);
                  setLatitudeError(null);
                  setLongitudeError(null);
                }
                if (latitudeError) setLatitudeError(null);
              }}
              error={latitudeError}
              keyboardType="numbers-and-punctuation"
              onBlur={() => {
                if (!latitudeEdited) return;
                const left = coordinateBlur(
                  latitudeShown,
                  isValidLatitude,
                  PLACE_FORM.copy.latitudeInvalid,
                );
                if (!left) return;
                setLatitude(left.text);
                setLatitudeError(left.error);
              }}
            />
          </View>
          <View style={styles.coordField}>
            <TextField
              label={PLACE_FORM.copy.longitude}
              requiredMark
              reserveError
              value={longitudeShown}
              onChangeText={(next) => {
                const entry = coordinateEntry(
                  next,
                  "longitude",
                  longitudeShown,
                );
                setLatitude((was) => entry.latitude ?? was);
                setLongitude((was) => entry.longitude ?? was);
                setLongitudeEdited(true);
                // A pair fills both, so neither keeps its old error.
                if (
                  entry.latitude !== undefined &&
                  entry.longitude !== undefined
                ) {
                  setLatitudeEdited(true);
                  setLongitudeEdited(true);
                  setLatitudeError(null);
                  setLongitudeError(null);
                }
                if (longitudeError) setLongitudeError(null);
              }}
              error={longitudeError}
              keyboardType="numbers-and-punctuation"
              onBlur={() => {
                if (!longitudeEdited) return;
                const left = coordinateBlur(
                  longitudeShown,
                  isValidLongitude,
                  PLACE_FORM.copy.longitudeInvalid,
                );
                if (!left) return;
                setLongitude(left.text);
                setLongitudeError(left.error);
              }}
            />
          </View>
        </View>
        <Text style={styles.coordsHint}>{PLACE_FORM.copy.coordinatesHint}</Text>
        {/* Under the coordinates it fills in, because that is what it does —
            not at the top as a second way to start. Nothing is lost by going:
            the form comes back exactly as it was left. */}
        {onPickOnMap ? (
          <Button
            label={PLACE_FORM.copy.selectOnMap}
            icon="place"
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
            <Icon idea="place" size={14} color={theme.accent} />
            <Text style={styles.hint}>Filled in from the map.</Text>
          </View>
        ) : null}
      </>
    ),
    notes: (
      <>
        {/* No SectionHeader: the field's own label already says "Notes", and
            the pair printed it twice. */}
        <TextField
          label={PLACE_FORM.copy.notes}
          value={notes}
          onChangeText={setNotes}
          multiline
          autoCapitalize="sentences"
          hint={PLACE_FORM.copy.notesHint}
        />
      </>
    ),
    attributes: (
      <>
        {/* Named for the TYPE, not for the user: on a Campsite these are
            Capacity and Is-a-cave, which are ours, not theirs. Absent when the
            type has none rather than standing over nothing. */}
        {typeFieldDefs.length > 0 ? (
          <SectionHeader
            title={placeAttributesTitle(typeName(placeTypeId, placeTypes.data))}
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
          icon="tag"
          title={`Your place ${ATTRIBUTE_NOUN.many}`}
          subtitle={
            typeFieldDefs.length === 0
              ? "Add your own — permits, access notes, anything."
              : `${typeFieldDefs.length} on this type`
          }
          chevron
          onPress={() => setMode("fields")}
        />
      </>
    ),
  };

  return (
    <>
      <BottomSheet
        visible={visible && !away}
        discard={dirty ? abandonConfirm("place", !editing) : null}
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
            <FormStack>
              {/* Not attributable to one control (a field-value range, a save
                the outbox rejected) — directly above Save, never at the top
                of the form where it can sit out of sight of the button
                (shared/DESIGN.md §11). */}
              {formError ? <ErrorBanner message={formError} /> : null}
              <Button
                label={
                  editing
                    ? PLACE_FORM.copy.saveSubmit
                    : PLACE_FORM.copy.addSubmit
                }
                icon="done"
                loading={saving}
                onPress={() => void save()}
              />
            </FormStack>
          ) : mode === "fieldForm" ? (
            fieldForm.footer
          ) : mode === "fields" ? (
            // PINNED, keeping the action this mode exists for visible above the
            // list rows.
            <Button
              label={ATTRIBUTE_NOUN.add}
              icon="add"
              onPress={() => {
                setEditingField(null);
                setMode("fieldForm");
              }}
            />
          ) : (
            <Button label="Done" icon="done" onPress={() => setMode("form")} />
          )
        }
      >
        {mode === "date" && dateFieldKey ? (
          <FormStack>
            <DatePicker
              value={fieldValues[dateFieldKey] || null}
              onChange={(key) =>
                setFieldValues((current) => ({
                  ...current,
                  [dateFieldKey]: key,
                }))
              }
            />
            {/* An attribute date may be unknown; a picker with no way back to
              blank turns that into a wrong answer. */}
            {fieldValues[dateFieldKey] ? (
              <Button
                label="Clear date"
                icon="close"
                variant="ghost"
                onPress={() => {
                  setFieldValues((current) => ({
                    ...current,
                    [dateFieldKey]: "",
                  }));
                  setMode("form");
                }}
              />
            ) : null}
          </FormStack>
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
          <FormStack>
            {contractSectionKeys(PLACE_FORM, "gps").map((key) => (
              <Fragment key={key}>{sections[key]}</Fragment>
            ))}
          </FormStack>
        )}
      </BottomSheet>

      {/* The pickers of a new place's photos and way, each shown alone while the
        form above is out of the way (DESIGN.md §4: never a second sheet). */}
      {editing ? null : (
        <>
          <BottomSheet
            visible={pickSheet === "photos"}
            onClose={() => setPickSheet(null)}
            onClosed={photoSheetClosed}
            title="Add a photo or video"
          >
            <Row
              icon="camera"
              title="Take photo"
              onPress={() => pickFrom("camera", "photo")}
            />
            <Row
              icon="video"
              title="Record video"
              onPress={() => pickFrom("camera", "video")}
            />
            <Row
              icon="photo"
              title="Choose from library"
              onPress={() => pickFrom("library", "photo")}
            />
          </BottomSheet>
          <AddWaySheet
            placeId={null}
            placeName={draft.name}
            media={[]}
            visible={pickSheet === "way"}
            onClose={() => setPickSheet(null)}
            onClosed={() => setAway(false)}
            onStage={(way) => setStaged((current) => ({ ...current, way }))}
            onInfo={() => {}}
            onError={setFormError}
          />
        </>
      )}
    </>
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

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

const useStyles = makeStyles((theme, textRole) => ({
  hint: { ...muted(theme, textRole.detail), flex: 1 },
  coordsHint: muted(theme, textRole.detail),
  coordRow: { flexDirection: "row", gap: spacing(1) },
  coordField: { flex: 1 },
  fixNote: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
}));
