import { useState, useEffect, useId, useMemo, useRef } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import type { ScopedCustomFieldDef, TripLogCustomFieldType, MediaItem } from "@logjam/shared";
import {
  coerceFieldValue,
  mediaCategory,
  buildCustomFieldDef,
  fieldValue,
  setFieldValues as withFieldValues,
  SOURCES_FIELD_KEY,
  SYSTEM_PLACE_TYPE_IDS,
  defsForType,
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  isSystemFieldDef,
  isValidLatitude,
  isValidLongitude,
} from "@logjam/shared";
import { numericFieldError, type NumericFieldConstraints } from "../../numberInput";
import type { TPlace, TPlaceType } from "../../placeUtils";
import {
  updatePlace,
  createPlace,
  deletePlace,
  getPlaceDetail,
  createCustomField,
  isHttpUrl,
} from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { FieldError } from "../feedback/FieldError";
import { useToast } from "../feedback/ToastProvider";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import AddCustomFieldForm from "./AddCustomFieldForm";
import CustomFieldInput, { customFieldValueError } from "./CustomFieldInput";
import ConfirmDialog from "./ConfirmDialog";
import DeleteCustomFieldDialog from "./DeleteCustomFieldDialog";
import MediaUpload from "../media/MediaUpload";
import MediaGallery from "../media/MediaGallery";
import { placeTypeLucideIcon } from "../sidebar/panels/placeTypeIcon";
import {
  Button,
  ChipRail,
  Dialog,
  IconButton,
  NumberField,
  SectionHeader,
  TextArea,
  TextField,
} from "../../ui";
import classes from "./PlaceDialog.module.css";

type Source = { label: string; url: string };

const LAT_CONSTRAINTS: NumericFieldConstraints = {
  min: LATITUDE_RANGE.min,
  max: LATITUDE_RANGE.max,
};
const LNG_CONSTRAINTS: NumericFieldConstraints = {
  min: LONGITUDE_RANGE.min,
  max: LONGITUDE_RANGE.max,
};

/**
 * A place: what it is, where it is, and what this type of place records.
 *
 * EVERY ATTRIBUTE IS DRAWN FROM ITS DEFINITION. The seven canyon grades were
 * seven hand-written controls keyed to `CANYON_FORM_FIELD_KEYS` — two selects
 * of literal 1-7, a roman-numeral one, four number boxes and their tooltips —
 * and the rest of the type's fields rendered generically underneath, with the
 * seven subtracted so they were not asked twice. They are ordinary field
 * values with ordinary definitions, so they render like every other field now
 * (`CustomFieldInput`, `railStops`), exactly as Logjam GPS already draws them.
 * Three things follow: the subtraction is gone, a user's own "Difficulty, 1-5"
 * gets the same rail a V grade does, and the sentences that were tooltips are
 * `hint`s on the definitions themselves (`SYSTEM_FIELD_DEFS`), where a user's
 * own field could have one too.
 */
function PlaceDialog({
  place,
  open,
  onClose,
  onSaved,
  onPickCoords,
  onCancelPickCoords,
  customFieldDefs,
  onCustomFieldDefsChange,
  placeTypes,
  onMediaChanged,
}: {
  place: TPlace | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  onCancelPickCoords: () => void;
  /** SCOPED definitions: which types each appears on decides which fields this
   *  form has at all. */
  customFieldDefs: ScopedCustomFieldDef[];
  onCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  /** The types the user may file a place under — their own plus the system
   *  three. Always ALL of them here, including empty ones: a picker that hid
   *  a type with no places in it could never be used to make the first one. */
  placeTypes: TPlaceType[];
  // Called after a media/track upload or delete so the opener (place detail
  // panel) can refresh its slideshow/track without waiting for a Save.
  onMediaChanged?: () => void;
}) {
  const isEdit = place != null;

  const toast = useToast();
  const formId = useId();
  const [name, setName] = useState("");
  const [altNames, setAltNames] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [notes, setNotes] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  // THE TYPE, chosen first. It decides which fields the form below has, so it
  // sits at the top of the dialog rather than among them.
  const [placeTypeId, setPlaceTypeId] = useState<string>(SYSTEM_PLACE_TYPE_IDS.canyon);

  /**
   * The fields THIS type has. `defsForType` is the shared rule (a definition
   * appears on a type it is scoped to, or on every type when it is flagged),
   * so the phone and the browser cannot disagree about which fields a campsite
   * has — and nothing is subtracted from it any more, because nothing else on
   * this form draws a field.
   */
  const typeFieldDefs = useMemo(
    () => defsForType(customFieldDefs, placeTypeId),
    [customFieldDefs, placeTypeId],
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which field failed validation, so the input can show error state + aria-invalid.
  const [invalidField, setInvalidField] = useState<"name" | "coords" | null>(null);
  // Set on a Save attempt so every out-of-range numeric field shows its inline
  // error at once (before that, errors only show after a field is blurred).
  const [showFieldErrors, setShowFieldErrors] = useState(false);

  // Add custom field form state
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<TripLogCustomFieldType>("string");
  const [newFieldBounded, setNewFieldBounded] = useState(false);
  const [newFieldMin, setNewFieldMin] = useState("");
  const [newFieldMax, setNewFieldMax] = useState("");
  const [addingField, setAddingField] = useState(false);
  const [addFieldError, setAddFieldError] = useState<string | null>(null);

  // Custom-field deletion confirmation
  const [fieldToDelete, setFieldToDelete] = useState<ScopedCustomFieldDef | null>(null);

  // Media. In edit mode the place exists; in create mode a draft place is
  // lazily materialised on first upload so files have something to link to
  // (mirrors TripLogDialog). Cancel deletes an uncommitted draft.
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [draftPlaceId, setDraftPlaceId] = useState<string | null>(null);
  const committedRef = useRef(false);
  const draftPromiseRef = useRef<Promise<string> | null>(null);

  const pickingRef = useRef(false);

  // Snapshot of the form fields as populated below, taken in the same effect
  // that sets them — used by the unsaved-changes guard to tell a real edit
  // apart from "the dialog is open" (PLACE-3). Sources/fieldValues are
  // compared by JSON value, not identity.
  const initialFormSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (pickingRef.current) {
      pickingRef.current = false;
      return;
    }
    let initialName: string;
    let initialAltNames: string;
    let initialLatitude: string;
    let initialLongitude: string;
    let initialNotes: string;
    let initialSources: Source[];
    let initialFieldValues: Record<string, string>;
    // Editing keeps the place's own type; creating defaults to Canyon, which
    // is what this app is for. Retyping IS allowed on an edit: miscategorising
    // is inevitable, and the server parks any value the new type has no
    // definition for rather than dropping it (§2.6).
    const initialPlaceTypeId = place?.placeTypeId ?? SYSTEM_PLACE_TYPE_IDS.canyon;
    if (place) {
      initialName = place.name;
      initialAltNames = place.altNames.join(", ");
      initialLatitude = String(place.latitude);
      initialLongitude = String(place.longitude);
      initialNotes = place.notes ?? "";
      const storedSources = place.fieldValues?.[SOURCES_FIELD_KEY];
      initialSources = (Array.isArray(storedSources)
        ? (storedSources as [string, string][])
        : []
      ).map(([label, url]) => ({ label, url }));
      // Existing field values as strings — the grades among them, which is
      // what makes them ordinary. Reads the TOP level of fieldValues; these
      // used to be nested under `attributes.customFields`, and the forward
      // migration hoisted them.
      const vals: Record<string, string> = {};
      for (const def of customFieldDefs) {
        const raw = fieldValue(place.fieldValues, def.key);
        vals[def.key] = raw != null ? String(raw) : "";
      }
      initialFieldValues = vals;
    } else {
      initialName = "";
      initialAltNames = "";
      initialLatitude = "";
      initialLongitude = "";
      initialNotes = "";
      initialSources = [];
      initialFieldValues = {};
    }
    setName(initialName);
    setAltNames(initialAltNames);
    setLatitude(initialLatitude);
    setLongitude(initialLongitude);
    setNotes(initialNotes);
    setSources(initialSources);
    setFieldValues(initialFieldValues);
    setPlaceTypeId(initialPlaceTypeId);
    initialFormSnapshotRef.current = JSON.stringify({
      name: initialName,
      altNames: initialAltNames,
      latitude: initialLatitude,
      longitude: initialLongitude,
      notes: initialNotes,
      sources: initialSources,
      fieldValues: initialFieldValues,
      placeTypeId: initialPlaceTypeId,
    });
    setError(null);
    setInvalidField(null);
    setShowFieldErrors(false);
    setShowAddField(false);
    setNewFieldLabel("");
    setNewFieldType("string");
    setNewFieldBounded(false);
    setNewFieldMin("");
    setNewFieldMax("");
    setAddFieldError(null);
    // Reset media/draft tracking each time the dialog opens.
    setMedia([]);
    setDraftPlaceId(null);
    committedRef.current = false;
    draftPromiseRef.current = null;
    // Focus is the kit Dialog's: it moves to `data-autofocus` (the name field)
    // when the dialog is shown, and back to the opener on close.
  }, [open, place]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real dirty-check: current form fields vs. the snapshot taken when the
  // dialog was (re)populated — not just "the dialog is open" (PLACE-3).
  // Media/custom-field-def edits are excluded: both persist immediately
  // (media uploads, and add/delete-field through their own endpoints), so
  // they're never "unsaved" by the time a close is attempted.
  const isDirty =
    open &&
    initialFormSnapshotRef.current !== null &&
    JSON.stringify({
      name,
      altNames,
      latitude,
      longitude,
      notes,
      sources,
      fieldValues,
      placeTypeId,
    }) !== initialFormSnapshotRef.current;

  const guard = useUnsavedChangesGuard(isDirty, () => void handleRequestClose());

  // In edit mode, fetch the place's existing media (fresh presigned URLs).
  useEffect(() => {
    if (!open || !place) return;
    const { id } = place;
    setMediaLoading(true);
    getPlaceDetail(id)
      .then((detail) => setMedia(detail.media))
      .catch((err) => {
        console.error(err);
        setError(messageFromError(err, "Couldn't load place media."));
      })
      .finally(() => setMediaLoading(false));
  }, [open, place?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The place id media should link to: the real place in edit mode, otherwise
  // a draft created on first upload. Guarded so concurrent uploads create one.
  function ensureLinkedPlaceId(): Promise<string> {
    if (place) return Promise.resolve(place.id);
    if (draftPlaceId) return Promise.resolve(draftPlaceId);
    if (draftPromiseRef.current) return draftPromiseRef.current;

    const parsedLat = parseFloat(latitude);
    const parsedLng = parseFloat(longitude);
    if (!name.trim() || !latitude || !longitude || isNaN(parsedLat) || isNaN(parsedLng)) {
      return Promise.reject(new Error("Enter a name and location before adding media."));
    }
    if (!isValidLatitude(parsedLat) || !isValidLongitude(parsedLng)) {
      return Promise.reject(
        new Error("Enter a valid location (latitude -90 to 90, longitude -180 to 180) before adding media."),
      );
    }
    const promise = createPlace({
      name: name.trim(),
      latitude: parsedLat,
      longitude: parsedLng,
      // A media draft is always a new place, so it takes whatever type the
      // picker is showing.
      placeTypeId,
    })
      .then((created) => {
        setDraftPlaceId(created.id);
        return created.id;
      })
      .catch((err) => {
        draftPromiseRef.current = null;
        throw err;
      });
    draftPromiseRef.current = promise;
    return promise;
  }

  function handleMediaUploaded(item: MediaItem) {
    setMedia((prev) => [...prev, item]);
    onMediaChanged?.();
  }

  function handleMediaDeleted(id: string) {
    setMedia((prev) => prev.filter((m) => m.id !== id));
    onMediaChanged?.();
  }

  // Cancel/close. If a draft place was materialised but never saved, delete it
  // (cascades its media from S3 + DB + quota) before closing.
  async function handleRequestClose() {
    if (saving) return;
    if (!isEdit && draftPlaceId && !committedRef.current) {
      try {
        await deletePlace(draftPlaceId);
        onSaved();
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Couldn't discard uploaded media. Please try again."));
        return;
      }
    }
    onCancelPickCoords();
    onClose();
  }

  function handlePickCoords() {
    pickingRef.current = true;
    onPickCoords((lat, lng) => {
      setLatitude(String(lat));
      setLongitude(String(lng));
    });
  }

  // Enter-to-submit. Mirrors the Save button's `disabled` condition, because a
  // form still submits on Enter while its submit button is disabled — without
  // this, Enter would be a route around it (a second save mid-flight).
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    void handleSave();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setInvalidField(null);
    try {
      const parsedLat = parseFloat(latitude);
      const parsedLng = parseFloat(longitude);
      if (!name.trim()) {
        // Inline under the Name field (FieldError), not the bottom banner.
        setInvalidField("name");
        setSaving(false);
        return;
      }
      if (!latitude || !longitude || isNaN(parsedLat) || isNaN(parsedLng)) {
        // Inline under the coordinate fields (FieldError), not the bottom banner.
        setInvalidField("coords");
        setSaving(false);
        return;
      }

      // Range/format validation for the coordinates and for every attribute
      // this form SHOWED (PLACE-1/PLACE-2). Scoped for the same reason the
      // write below is: a field this form did not render cannot have an
      // invalid value the user could go and fix, so blocking Save on one would
      // be an unfixable error message.
      const numericInvalid =
        numericFieldError(latitude, LAT_CONSTRAINTS) ??
        numericFieldError(longitude, LNG_CONSTRAINTS);
      const attributeInvalid = typeFieldDefs.some(
        (def) => customFieldValueError(def, getFieldValue(def.key)) != null,
      );
      if (numericInvalid || attributeInvalid) {
        setShowFieldErrors(true);
        setError("Please fix the highlighted fields.");
        setSaving(false);
        return;
      }

      // FEUI-012: reject non-http(s) source URLs (javascript:, data:, ...)
      // rather than storing them verbatim to later render as a clickable href.
      const invalidSourceUrl = sources.some(
        (s) => s.url.trim() && !isHttpUrl(s.url.trim()),
      );
      if (invalidSourceUrl) {
        setError("Source URLs must start with http:// or https://.");
        setSaving(false);
        return;
      }

      const cleanSources: [string, string][] = sources
        .filter((s) => s.label.trim())
        .map((s) => [s.label.trim(), s.url.trim()]);

      // ONLY THE FIELDS THIS FORM SHOWED. Iterating every definition wrote a
      // null for the ones scoped to other types — and `setFieldValues` treats a
      // null as "remove this key", so saving a canyon deleted whatever was
      // recorded under a campsite-scoped field. A definition this type does not
      // carry was never asked here, and an unasked question has no answer to
      // store. `setFieldValues` drops the empty ones rather than storing nulls:
      // a stored null renders as a filled-in-but-blank field and satisfies a
      // "has a value" filter.
      const attributes: Record<string, unknown> = {};
      for (const def of typeFieldDefs) {
        attributes[def.key] = coerceFieldValue(getFieldValue(def.key), def.type);
      }

      const data = {
        name: name.trim(),
        altNames: altNames
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        latitude: parsedLat,
        longitude: parsedLng,
        placeTypeId,
        notes: notes || null,
        fieldValues: withFieldValues(place?.fieldValues ?? {}, {
          ...attributes,
          [SOURCES_FIELD_KEY]: cleanSources.length > 0 ? cleanSources : null,
        }),
      };

      if (isEdit) {
        await updatePlace(place.id, data);
      } else if (draftPlaceId) {
        // A draft was already created to hold uploaded media — persist the form.
        await updatePlace(draftPlaceId, data);
      } else {
        await createPlace(data);
      }
      committedRef.current = true;
      onSaved();
      toast.success("Place saved.");
      onClose();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't save place. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  function getFieldValue(key: string): string {
    return fieldValues[key] ?? "";
  }

  function setFieldValue(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  function resetAddField() {
    setShowAddField(false);
    setNewFieldLabel("");
    setNewFieldType("string");
    setNewFieldBounded(false);
    setNewFieldMin("");
    setNewFieldMax("");
    setAddFieldError(null);
  }

  async function handleAddField() {
    const result = buildCustomFieldDef(
      { label: newFieldLabel, type: newFieldType, bounded: newFieldBounded, min: newFieldMin, max: newFieldMax },
      customFieldDefs,
    );
    if ("error" in result) {
      setAddFieldError(result.error);
      return;
    }
    setAddingField(true);
    setAddFieldError(null);
    try {
      // ROW-GRAIN (see the note in placeUtils.ts): the whole-list PATCH is
      // gone, and it would have wiped the scoping off every definition.
      // Scoped to the type this place IS, because that is the form the user
      // was looking at when they added the field.
      const updatedDefs = await createCustomField("place", result.def, {
        placeTypeIds: [placeTypeId],
      });
      onCustomFieldDefsChange(updatedDefs);
      resetAddField();
    } catch (err) {
      console.error(err);
      setAddFieldError(messageFromError(err, "Couldn't save custom field. Please try again."));
    } finally {
      setAddingField(false);
    }
  }

  // The unified delete (server strips the field's values from every place +
  // updates the def list) is handled by DeleteCustomFieldDialog; here we only
  // mirror the removal in local state after it succeeds.
  function handleFieldDeleted(remainingDefs: ScopedCustomFieldDef[]) {
    const key = fieldToDelete?.key;
    onCustomFieldDefsChange(remainingDefs);
    if (key) {
      setFieldValues((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  const retyped = isEdit && place != null && placeTypeId !== place.placeTypeId;

  return (
    <>
      <Dialog
        open={open}
        title={isEdit ? "Edit place" : "Add a place"}
        size="large"
        dismissible={!saving}
        onClose={guard.requestClose}
        footer={
          <>
            {/* Not "Cancel": the add-attribute sub-form renders its own
                "Cancel" that only backs out of that sub-form, and both can be
                on screen at once. In edit mode the object is the *changes*,
                not the place. */}
            <Button onClick={guard.requestClose} disabled={saving}>
              {isEdit ? "Discard changes" : "Discard place"}
            </Button>
            {/* type="submit" with no onClick — handleSubmit is the only save
                path, so a click can't fire alongside the form's submit. */}
            <Button type="submit" form={formId} variant="filled" busy={saving}>
              {isEdit ? "Save changes" : "Add place"}
            </Button>
          </>
        }
      >
        <form id={formId} className={classes.form} noValidate onSubmit={handleSubmit}>
          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            error={invalidField === "name" ? "Name is required" : null}
            data-autofocus
          />

          {/* TYPE FIRST. It decides what the rest of this form is, so it goes
              above the fields it governs rather than at the bottom with them —
              and it is the same rail, with the same glyphs and hues, that the
              Places page filters by. Offered on an EDIT too: miscategorising is
              inevitable, and the server parks any value the new type has no
              definition for rather than dropping it, so retyping is reversible,
              which is what makes it safe to offer. */}
          <div className={classes.field}>
            <span className={classes.fieldLabel}>Type</span>
            <ChipRail
              label="Type"
              options={placeTypes.map((type) => ({
                value: type.id,
                label: type.name,
                icon: placeTypeLucideIcon(type.iconKey),
                hue: type.color,
              }))}
              value={placeTypeId}
              onChange={setPlaceTypeId}
            />
            {retyped && (
              <p className={classes.hint}>
                Values this type has no field for are kept on the place, and can be added to
                it later.
              </p>
            )}
          </div>

          <TextField
            label="Other names"
            hint="Separate them with commas."
            value={altNames}
            onChange={(event) => setAltNames(event.target.value)}
          />

          <div className={classes.field}>
            <div className={classes.coordinates}>
              <NumberField
                label="Latitude"
                className={classes.grow}
                value={latitude}
                onChange={setLatitude}
                constraints={LAT_CONSTRAINTS}
                showError={showFieldErrors || invalidField === "coords"}
                hint="Decimal degrees (WGS84)."
                required
              />
              <NumberField
                label="Longitude"
                className={classes.grow}
                value={longitude}
                onChange={setLongitude}
                constraints={LNG_CONSTRAINTS}
                showError={showFieldErrors || invalidField === "coords"}
                hint="Decimal degrees (WGS84)."
                required
              />
              <Button
                icon={MapPin}
                className={classes.pickButton}
                onClick={handlePickCoords}
                disabled={saving}
              >
                Pick on map
              </Button>
            </div>
            <FieldError
              message={invalidField === "coords" ? "Valid coordinates are required" : null}
            />
          </div>

          <TextArea
            label="Notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
          />

          {/* The chosen type's own attributes — the canyon grades among them,
              each drawn by the shape of its definition. */}
          <section className={classes.section}>
            <SectionHeader title="Attributes" />
            {typeFieldDefs.length === 0 && !showAddField && (
              <p className={classes.muted}>
                This type records nothing beyond a name and a place on the map.
              </p>
            )}
            {typeFieldDefs.map((def) => (
              <div key={def.key} className={classes.attribute}>
                <div className={classes.grow}>
                  <CustomFieldInput
                    def={def}
                    value={getFieldValue(def.key)}
                    onChange={(value) => setFieldValue(def.key, value)}
                    showError={showFieldErrors}
                  />
                </div>
                {/* ABSENT on a built-in, not disabled (DESIGN.md §7): the
                    server owns those definitions and refuses the delete, so
                    the verb does not exist here rather than being unavailable
                    right now. It never arose while the grades were drawn by
                    hand — they were the seven fields this list excluded. */}
                {!isSystemFieldDef(def) && (
                  <IconButton
                    icon={Trash2}
                    label={`Delete the attribute ${def.label}`}
                    tone="danger"
                    onClick={() => setFieldToDelete(def)}
                  />
                )}
              </div>
            ))}
            {showAddField ? (
              <AddCustomFieldForm
                label={newFieldLabel}
                onLabelChange={setNewFieldLabel}
                type={newFieldType}
                onTypeChange={setNewFieldType}
                onAdd={handleAddField}
                onCancel={resetAddField}
                adding={addingField}
                error={addFieldError}
                bounds={{
                  bounded: newFieldBounded,
                  onBoundedChange: setNewFieldBounded,
                  min: newFieldMin,
                  onMinChange: setNewFieldMin,
                  max: newFieldMax,
                  onMaxChange: setNewFieldMax,
                }}
              />
            ) : (
              <Button
                compact
                icon={Plus}
                className={classes.addAttribute}
                onClick={() => {
                  setAddFieldError(null);
                  setShowAddField(true);
                }}
              >
                Add an attribute
              </Button>
            )}
          </section>

          <section className={classes.section}>
            <SectionHeader title="Sources" />
            {sources.map((source, index) => (
              <div key={index} className={classes.source}>
                <TextField
                  label="Label"
                  className={classes.grow}
                  value={source.label}
                  onChange={(event) => {
                    const next = [...sources];
                    next[index] = { ...next[index], label: event.target.value };
                    setSources(next);
                  }}
                />
                <TextField
                  label="Link"
                  className={classes.grow}
                  value={source.url}
                  placeholder="https://"
                  onChange={(event) => {
                    const next = [...sources];
                    next[index] = { ...next[index], url: event.target.value };
                    setSources(next);
                  }}
                />
                <IconButton
                  icon={Trash2}
                  label={`Delete the source ${source.label || index + 1}`}
                  tone="danger"
                  onClick={() => setSources(sources.filter((_, other) => other !== index))}
                />
              </div>
            ))}
            <Button
              compact
              icon={Plus}
              className={classes.addAttribute}
              onClick={() => setSources([...sources, { label: "", url: "" }])}
            >
              Add a source
            </Button>
          </section>

          {/* Media — photos/videos and a single optional track. In create mode
              the first upload lazily materialises a draft place to link to. */}
          <section className={classes.section}>
            <SectionHeader title="Photos & videos" />
            {mediaLoading ? (
              <p className={classes.muted} role="status">
                Loading files…
              </p>
            ) : (
              <MediaGallery
                media={media}
                variant="visual"
                canDelete
                onDeleted={handleMediaDeleted}
                emptyText="No photos or videos yet."
              />
            )}
            <MediaUpload
              category="visual"
              linkedType="place"
              linkedId={place ? place.id : ""}
              resolveLinkedId={place ? undefined : ensureLinkedPlaceId}
              onUploaded={handleMediaUploaded}
              disabled={saving}
            />
          </section>

          <section className={classes.section}>
            <SectionHeader title="Track" />
            {!mediaLoading && (
              <MediaGallery
                media={media}
                variant="tracks"
                canDelete
                onDeleted={handleMediaDeleted}
                emptyText="No track yet."
              />
            )}
            <MediaUpload
              category="track"
              maxFiles={1}
              linkedType="place"
              linkedId={place ? place.id : ""}
              resolveLinkedId={place ? undefined : ensureLinkedPlaceId}
              onUploaded={handleMediaUploaded}
              disabled={saving}
              disabledReason={
                media.some((m) => mediaCategory(m.mediaType) === "track")
                  ? "This place already has a track. Delete it to add another."
                  : undefined
              }
            />
          </section>

          {error && <ErrorBanner message={error} />}
        </form>
      </Dialog>

      <DeleteCustomFieldDialog
        entity="place"
        def={fieldToDelete}
        onClose={() => setFieldToDelete(null)}
        onDeleted={handleFieldDeleted}
      />

      <ConfirmDialog
        open={guard.guardOpen}
        title="Discard unsaved changes?"
        message="Your changes will be lost."
        confirmLabel="Discard"
        confirmColor="error"
        onConfirm={guard.confirmDiscard}
        onClose={guard.cancelDiscard}
      />
    </>
  );
}

export default PlaceDialog;
