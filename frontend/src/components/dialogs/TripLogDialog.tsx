import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  buildCustomFieldDef,
  CANYONING_TRIP_TYPE,
  coerceFieldValue,
  formatFieldValue,
  enforceCanyoningTag,
  linksCanyon,
  formatTripPlaceNames,
  isValidLatitude,
  isValidLongitude,
  MAX_PLACES_PER_TRIP,
  MAX_TRIP_TYPES_PER_TRIP,
  primaryTripType,
  SYSTEM_PLACE_TYPE_IDS,
  todayDateKey,
  tripPrefillFromTrack,
  TRIP_TYPE_SUGGESTIONS,
  tripFieldDefs,
  tripTypeLabel,
  type MediaItem,
  type ScopedCustomFieldDef,
  type TripLogCustomFieldDef,
  type TripLogCustomFieldType,
} from "@logjam/shared";
import { useToast } from "../feedback/ToastProvider";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import type { TPlace, TTripLog } from "../../placeUtils";
import {
  createTripLog,
  updateTripLog,
  deleteTripLog,
  getMediaDownloadUrls,
  getTripLog,
  createPlace,
  createCustomField,
  uploadMedia,
} from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import {
  clearTripDraft,
  readTripDraft,
  tripFormFingerprint,
  writeTripDraft,
  type TripDraft,
  type TripDraftForm,
} from "../../tripDraft";
import MediaUpload from "../media/MediaUpload";
import { generateThumbnail, resolveMediaType } from "../media/mediaFiles";
import MediaGallery from "../media/MediaGallery";
import { tripTypeLook } from "../sidebar/panels/tripTypeIcon";
import {
  Button,
  ChipPicker,
  Dialog,
  IconButton,
  IconTile,
  Row,
  SearchField,
  SectionHeader,
  TextArea,
  TextField,
  Icon,
  ErrorBanner,
  FieldError,
} from "../../ui";
import AddCustomFieldForm from "./AddCustomFieldForm";
import CustomFieldInput, { customFieldValueError } from "./CustomFieldInput";
import DeleteCustomFieldDialog from "./DeleteCustomFieldDialog";
import ConfirmDialog from "./ConfirmDialog";
import classes from "./TripLogDialog.module.css";

// True when a date-only string (YYYY-MM-DD) is after today. Both sides are
// local-calendar YYYY-MM-DD strings (a native date input yields a local
// calendar date, and `todayDateKey` reads the local clock), so this is a plain
// lexicographic comparison with no timezone off-by-one.
function isFutureDate(dateString: string): boolean {
  return dateString > todayDateKey();
}

// The pending inline-create is part of the persisted draft, so its shape is
// declared once in tripDraft.ts and derived here rather than repeated.
type CreateForm = NonNullable<TripDraftForm["creating"]>;

// Autosave trails typing by this much: long enough that a sentence is one write
// rather than forty, short enough that a phone call mid-word still loses at
// most half a second of text.
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 500;

// The draft's savedAt is a true timestamp, so it formats in local time — the
// `timeZone: "UTC"` rule covers date-only values (trip dates), not this. Inside
// the 7-day expiry window a weekday + time is unambiguous and reads the way the
// user remembers the trip ("Tuesday evening").
function formatDraftSavedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Case-insensitive dedupe that preserves the casing of the first occurrence —
// used to union the built-in TRIP_TYPE_SUGGESTIONS with whatever casing the
// user has already typed into their own trip history.
function dedupeTypesPreserveCase(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const key = v.toLowerCase();
    if (!seen.has(key)) seen.set(key, v);
  }
  return Array.from(seen.values());
}

/**
 * A recorded track to log a trip FROM: the form opens on the track's day, with
 * its place linked and the track already in the Tracks section.
 */
export type TripLogTrack = {
  mediaId: string;
  /** The file's own name, extension included: the API pins the format on it. */
  filename: string;
  startedAt: string | null;
  /** The track's place, if it is on one the user owns. */
  placeId: string | null;
};

/**
 * Log or edit a trip — one form for both, because the fields are identical and
 * a second form would drift (Logjam GPS's `TripEditSheet`).
 *
 * Choosing places is a MODE of this dialog, not a dialog of its own (DESIGN.md
 * §6): the body swaps to a searchable list, the title says which step this is,
 * and Escape, the close button and Done all back out to the form rather than
 * out of the dialog.
 */
function TripLogDialog({
  open,
  onClose,
  onSaved,
  places,
  defaultPlaceId = null,
  fromTrack = null,
  tripLog,
  customFieldDefs,
  onCustomFieldDefsChange,
  existingTripTypes,
  onPickCoords,
  onPlaceCreated,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  places: TPlace[];
  // Create-mode default selection (e.g. the place whose detail panel opened the
  // dialog) — seeds the initial multi-selection. Edit mode always uses the
  // trip's own places. Defaults to none.
  defaultPlaceId?: string | null;
  // Create-mode only: log the trip from this track (`TripLogTrack`).
  fromTrack?: TripLogTrack | null;
  tripLog?: TTripLog;
  customFieldDefs: ScopedCustomFieldDef[];
  onCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  // Raw (non-deduped) trip.types values flattened from whichever trip list the
  // caller has on hand — unioned with TRIP_TYPE_SUGGESTIONS for the type chips.
  existingTripTypes: string[];
  onPickCoords?: (onPicked: (lat: number, lng: number) => void) => void;
  // Fired when an inline "Create new place" makes a real place, so the parent
  // can refetch the place list/map (otherwise the new marker only shows after a
  // manual refresh).
  onPlaceCreated?: () => void;
}) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const formId = useId();
  const [date, setDate] = useState(todayDateKey());
  const [notes, setNotes] = useState("");
  // Ordered ids of selected existing places — order is meaningful (drives the
  // derived title).
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<string[]>([]);
  // User's trip-name override. "" means unset (falls back to the derived
  // title); independent of place selection.
  const [displayNameInput, setDisplayNameInput] = useState("");
  // Ordered selected trip types (user vocab, case preserved as typed) —
  // capped at MAX_TRIP_TYPES_PER_TRIP, deduped case-insensitively on add.
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  // Types added through the chip picker this session, so one deselected again
  // keeps its chip rather than vanishing under the pointer.
  const [addedTypes, setAddedTypes] = useState<string[]>([]);
  // At most one pending inline "create new place" at a time.
  const [creating, setCreating] = useState<CreateForm | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  // The attribute keys this form keeps whatever the tags say: the ones stored
  // when it opened and the ones typed into (or restored from a draft) since.
  // See `visibleFieldDefs`.
  const [keptFieldKeys, setKeptFieldKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set on a Save attempt so every invalid custom field shows its inline error
  // at once (before that, errors only show after a field is blurred).
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const [mode, setMode] = useState<"form" | "places">("form");
  const [placeSearch, setPlaceSearch] = useState("");
  // A choice a picker refuses (the place or type cap) is that picker's own
  // error, under it, not a toast.
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);

  // Linking a canyon means "I did that canyon on this trip", so the API
  // force-tags `canyoning` on save. Mirror that in the selection itself (rather
  // than only in the rendered chips) so the tag is visible before the user hits
  // Save instead of appearing afterwards, and so the cap checks below count it
  // exactly as storage does. Applied during render when `linkedCanyon` flips,
  // as an effect would, but without painting the untagged selection first.
  //
  // A CANYON, not any place: a campsite or a marker tags nothing
  // (`linksCanyon`). An inline pending create is a canyon (see `creating`).
  function placeTypeIdsFor(ids: string[]): string[] {
    return ids
      .map((id) => places.find((place) => place.id === id)?.placeTypeId)
      .filter((typeId): typeId is string => !!typeId);
  }
  const linkedCanyon = linksCanyon([
    ...placeTypeIdsFor(selectedPlaceIds),
    ...(creating ? [SYSTEM_PLACE_TYPE_IDS.canyon] : []),
  ]);
  const [prevLinkedCanyon, setPrevLinkedCanyon] = useState(linkedCanyon);
  if (linkedCanyon !== prevLinkedCanyon) {
    setPrevLinkedCanyon(linkedCanyon);
    setSelectedTypes((prev) => enforceCanyoningTag(prev, linkedCanyon));
  }

  // Media. In edit mode the trip already exists; in create mode we lazily
  // materialise a draft trip on first upload so files have something to link to.
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [draftTripId, setDraftTripId] = useState<string | null>(null);
  // Set once the trip has been saved/committed, so closing won't delete it.
  const committedRef = useRef(false);
  // De-dupes concurrent draft creation when several files upload at once.
  const draftPromiseRef = useRef<Promise<string> | null>(null);
  // Tracks pick-on-map cycle so the reset useEffect skips when returning.
  // State, not a ref: the render that reopens the dialog reads it too
  // (`focusDateOnOpen`).
  const [picking, setPicking] = useState(false);
  // The places field, which takes focus back when the picker closes.
  const placesFieldRef = useRef<HTMLDivElement>(null);

  // Add custom field form state
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] =
    useState<TripLogCustomFieldType>("string");
  const [newFieldBounded, setNewFieldBounded] = useState(false);
  const [newFieldMin, setNewFieldMin] = useState("");
  const [newFieldMax, setNewFieldMax] = useState("");
  const [addingField, setAddingField] = useState(false);
  const [addFieldError, setAddFieldError] = useState<string | null>(null);
  // Field pending deletion via the shared impact-aware confirm (also used by
  // Settings' attribute lists).
  const [fieldToDelete, setFieldToDelete] =
    useState<TripLogCustomFieldDef | null>(null);

  /**
   * THE FIELDS THIS TRIP IS ASKED FOR — the ones scoped to the trip's own TYPES
   * (the selected tags) — and, after them, the ones it only KEEPS: stored when
   * the dialog opened, or typed into since (`tripFieldDefs`).
   *
   * The save writes exactly the fields shown, so a kept field must stay on the
   * form when its tag comes off or the save drops it. Kept-only fields sit in
   * their own "Leftover attributes" section with a remove button, as on Logjam
   * GPS: removing drops the key from the kept set, so the save leaves it out;
   * closing without saving brings it back, which is why there is no confirm.
   */
  const visibleFieldDefs = useMemo(
    () => tripFieldDefs(customFieldDefs, selectedTypes, null, keptFieldKeys),
    [customFieldDefs, keptFieldKeys, selectedTypes],
  );
  const askedFieldDefs = useMemo(
    () => tripFieldDefs(customFieldDefs, selectedTypes, null),
    [customFieldDefs, selectedTypes],
  );
  const leftoverFieldDefs = visibleFieldDefs.filter(
    (def) => !askedFieldDefs.includes(def),
  );

  // Names of the currently selected places (incl. a pending create, for a live
  // preview), in selection order — feeds the derived title.
  const selectedPlaceNames = useMemo(() => {
    const names = selectedPlaceIds
      .map((id) => places.find((c) => c.id === id)?.name)
      .filter((n): n is string => !!n);
    if (creating?.name) names.push(creating.name);
    return names;
  }, [selectedPlaceIds, places, creating]);

  // Snapshot of the form fields as populated below, taken in the same effect
  // that sets them — used by the unsaved-changes guard to tell a real edit
  // apart from "the dialog is open" (TRIP-3). Moves when the form is
  // re-populated, which includes restoring a draft.
  const [initialFormSnapshot, setInitialFormSnapshot] = useState<string | null>(
    null,
  );
  // Snapshot of a *fresh* form, taken only on open and never re-taken. The two
  // baselines answer different questions and must not be merged:
  //   initialFormSnapshot → "would closing lose work done since the form was
  //     populated?" (the guard's question — a just-restored draft answers no)
  //   pristineFormSnapshot → "is there anything here worth persisting?"
  //     (the draft's question — a just-restored draft answers yes)
  const [pristineFormSnapshot, setPristineFormSnapshot] = useState<
    string | null
  >(null);
  // A restorable draft found on open, awaiting the user's restore/discard
  // answer. Non-null suppresses autosave, so ignoring the offer and typing
  // can't overwrite the very draft being offered. Create mode only.
  const [restorableDraft, setRestorableDraft] = useState<TripDraft | null>(
    null,
  );
  // One autosave-failure toast per open, not one per keystroke.
  const draftWarnedRef = useRef(false);
  // Whether the Dialog moves focus into the date field as it opens; settled by
  // the populate below, which knows whether a draft is offered (see
  // `focusDateOnOpen`).
  const [focusDateWhenOpened, setFocusDateWhenOpened] = useState(false);
  // Bumped by each populate, so the refs that track one open of the form start
  // over with it (the effect after this block).
  const [formSession, setFormSession] = useState(0);

  // Populate form when opening for edit (or reset on create). During render,
  // not in an effect, so the render that opens the Dialog already holds the
  // fresh form and the draft offer: the autosave effect never sees last
  // session's values, and the Dialog's focus-on-open sees the offer.
  // customFieldDefs is deliberately not part of the key — field defs shouldn't
  // reset the form values just because a new field was added mid-session.
  const openKey = open ? (tripLog?.id ?? "") : null;
  const [populatedFor, setPopulatedFor] = useState<string | null>(null);
  if (openKey !== populatedFor) {
    setPopulatedFor(openKey);
    if (openKey !== null) {
      // Each open (re)loads an existing trip's media, the return from picking
      // too; see the media effect below.
      setMediaLoading(!!tripLog);
      if (picking) {
        // Returning from a pick-on-map cycle — don't reset form state.
        setPicking(false);
        setFocusDateWhenOpened(false);
      } else {
        populateForm();
      }
    }
  }

  function populateForm() {
    let initialDate: string;
    let initialNotes: string;
    let initialSelectedPlaceIds: string[];
    let initialDisplayNameInput: string;
    let initialSelectedTypes: string[];
    let initialFieldValues: Record<string, string>;
    if (tripLog) {
      initialDate = tripLog.date.split("T")[0];
      initialNotes = tripLog.notes ?? "";
      initialSelectedPlaceIds = tripLog.places.map((c) => c.id);
      initialDisplayNameInput = tripLog.displayName ?? "";
      // Enforce here rather than letting the effect below do it, so the
      // unsaved-changes snapshot taken next already includes the tag — a trip
      // that predates enforcement would otherwise read as dirty the instant it
      // opened, and prompt on close without the user touching anything.
      initialSelectedTypes = enforceCanyoningTag(
        tripLog.types,
        linksCanyon(placeTypeIdsFor(initialSelectedPlaceIds)),
      );
      // Populate existing custom field values as strings
      const vals: Record<string, string> = {};
      for (const def of customFieldDefs) {
        const raw = tripLog.customFields[def.key];
        vals[def.key] = raw != null ? String(raw) : "";
      }
      initialFieldValues = vals;
    } else {
      // A track's own day and place, or the place the dialog was opened on and
      // today. A place the user no longer has is left out rather than linked.
      const fromTrackPrefill = fromTrack
        ? tripPrefillFromTrack(fromTrack)
        : null;
      initialDate = fromTrackPrefill?.date ?? todayDateKey();
      initialNotes = "";
      initialSelectedPlaceIds = fromTrackPrefill
        ? fromTrackPrefill.placeIds.filter((id) =>
            places.some((place) => place.id === id),
          )
        : defaultPlaceId
          ? [defaultPlaceId]
          : [];
      initialDisplayNameInput = "";
      initialSelectedTypes = enforceCanyoningTag(
        [],
        linksCanyon(placeTypeIdsFor(initialSelectedPlaceIds)),
      );
      initialFieldValues = {};
    }
    setDate(initialDate);
    setNotes(initialNotes);
    setSelectedPlaceIds(initialSelectedPlaceIds);
    setDisplayNameInput(initialDisplayNameInput);
    setSelectedTypes(initialSelectedTypes);
    setAddedTypes([]);
    setCreating(null);
    setFieldValues(initialFieldValues);
    setKeptFieldKeys(
      new Set(
        Object.entries(tripLog?.customFields ?? {})
          .filter(([, value]) => value != null)
          .map(([key]) => key),
      ),
    );
    setMode("form");
    setPlaceSearch("");
    setPlacesError(null);
    setTypesError(null);
    const initialFingerprint = tripFormFingerprint({
      date: initialDate,
      notes: initialNotes,
      selectedPlaceIds: initialSelectedPlaceIds,
      displayNameInput: initialDisplayNameInput,
      selectedTypes: initialSelectedTypes,
      fieldValues: initialFieldValues,
      creating: null,
    });
    setInitialFormSnapshot(initialFingerprint);
    setPristineFormSnapshot(initialFingerprint);
    // Offer any autosaved draft rather than restoring it silently: someone who
    // opened this to log today's trip would otherwise find last Tuesday's text
    // already typed and have to work out where it came from. Edit mode never
    // reads the draft — it holds a create form, and pouring it into an existing
    // trip would overwrite a saved one (tripDraft.ts re-checks `mode` too).
    const foundDraft = tripLog ? null : readTripDraft(new Date());
    setRestorableDraft(foundDraft);
    setFocusDateWhenOpened(foundDraft === null);
    setError(null);
    setShowFieldErrors(false);
    setShowAddField(false);
    setNewFieldLabel("");
    setNewFieldType("string");
    // Reset media/draft tracking each time the dialog opens.
    setMedia([]);
    setDraftTripId(null);
    setFormSession((session) => session + 1);
  }

  useEffect(() => {
    committedRef.current = false;
    draftPromiseRef.current = null;
    draftWarnedRef.current = false;
  }, [formSession]);

  // Open ready to type: the Dialog focuses the date field (`data-autofocus`).
  // Three deliberate opt-outs, which leave focus on the title:
  //  - a draft is being offered: the banner asks a question, and pulling focus
  //    into the form invites typing into fields that Restore is about to
  //    overwrite.
  //  - narrow web: focusing pops the on-screen keyboard over the form before
  //    the user has decided to type, hiding the fields they came to fill in.
  //  - the return from picking a point on the map: the date is not what the
  //    user was doing.
  const focusDateOnOpen = !isMobile && focusDateWhenOpened;

  // The form as the draft stores it — one object feeding both the dirty-check
  // and the autosave, so the two can't disagree about what "the form" is.
  const currentForm: TripDraftForm = useMemo(
    () => ({
      date,
      notes,
      selectedPlaceIds,
      displayNameInput,
      selectedTypes,
      fieldValues,
      creating,
    }),
    [
      date,
      notes,
      selectedPlaceIds,
      displayNameInput,
      selectedTypes,
      fieldValues,
      creating,
    ],
  );
  const currentFingerprint = useMemo(
    () => tripFormFingerprint(currentForm),
    [currentForm],
  );

  // Real dirty-check: current form fields vs. the snapshot taken when the
  // dialog was (re)populated — not just "the dialog is open" (TRIP-3). Media
  // is excluded: uploads persist immediately (or via the self-cleaning draft
  // trip in create mode), so they're never "unsaved" by the time a close is
  // attempted.
  const isDirty =
    open &&
    initialFormSnapshot !== null &&
    currentFingerprint !== initialFormSnapshot;

  // Whether there's anything in the form worth keeping. Measured against the
  // pristine baseline, so a restored draft still counts as worth keeping even
  // though the guard considers it clean.
  const draftWorthKeeping =
    open &&
    !tripLog &&
    pristineFormSnapshot !== null &&
    currentFingerprint !== pristineFormSnapshot;

  // Autosave the create form so a phone call, a tab eviction or a flat battery
  // doesn't take it — the exits `useUnsavedChangesGuard` structurally cannot
  // cover, because nobody is there to answer its prompt.
  useEffect(() => {
    if (!open || tripLog) return;
    // Don't overwrite the draft we're currently offering to restore.
    if (restorableDraft) return;
    const timer = setTimeout(() => {
      // Checked at fire time, not effect time: a save that resolves while this
      // timer is pending would otherwise be followed by the timer re-writing a
      // draft for the trip that was just saved.
      if (committedRef.current) return;
      if (!draftWorthKeeping) {
        // Back to a fresh form — the user emptied it, so the draft goes too.
        clearTripDraft();
        return;
      }
      const result = writeTripDraft(currentForm, new Date());
      if (result.status === "saved") return;
      // A draft the user assumes exists but doesn't is the exact failure this
      // feature exists to prevent, so say so instead of failing quietly. Once
      // per open — this runs on every keystroke.
      if (draftWarnedRef.current) return;
      draftWarnedRef.current = true;
      if (result.status === "too-large") {
        toast.error(
          "These notes are too long to save a local draft. Save the trip so it isn't lost.",
        );
      } else {
        console.error(result.error);
        toast.error(
          "Couldn't save a local draft of this trip. Save it so it isn't lost.",
        );
      }
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, tripLog, restorableDraft, draftWorthKeeping, currentForm, toast]);

  function handleRestoreDraft() {
    if (!restorableDraft) return;
    const { form } = restorableDraft;
    setDate(form.date);
    setNotes(form.notes);
    setSelectedPlaceIds(form.selectedPlaceIds);
    setDisplayNameInput(form.displayNameInput);
    setSelectedTypes(form.selectedTypes);
    setFieldValues(form.fieldValues);
    // A restored answer is the user's typing too: keep it on the form whatever
    // the restored tags say, or the save would drop it.
    setKeptFieldKeys(
      (prev) =>
        new Set([
          ...prev,
          ...Object.keys(form.fieldValues).filter(
            (key) => form.fieldValues[key] !== "",
          ),
        ]),
    );
    setCreating(form.creating);
    // The guard's baseline moves with the restore: the form was just populated
    // from the draft, so "dirty" means changed *since* the restore. Closing
    // straight after restoring shouldn't prompt to discard changes the user
    // just asked to keep — and the draft stays on disk regardless.
    setInitialFormSnapshot(tripFormFingerprint(form));
    // pristineFormSnapshot deliberately does NOT move — the restored form is
    // still worth autosaving, so it survives a second eviction.
    setRestorableDraft(null);
  }

  function handleDiscardDraft() {
    clearTripDraft();
    setRestorableDraft(null);
  }

  // In edit mode, fetch the trip's existing media (with fresh presigned URLs).
  useEffect(() => {
    if (!open || !tripLog) return;
    const { id } = tripLog;
    getTripLog(id)
      .then((full) => setMedia(full.media ?? []))
      .catch((err) => {
        console.error(err);
        setError(messageFromError(err, "Couldn't load trip files."));
      })
      .finally(() => setMediaLoading(false));
  }, [open, tripLog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the ordered placeIds for the trip payload, creating the pending
  // inline place (if any) first and appending it last.
  async function resolvePlaceIds(): Promise<string[]> {
    if (!creating) return selectedPlaceIds;
    if (!creating.name.trim()) throw new Error("Place name is required.");
    const lat = parseFloat(creating.latitude);
    const lng = parseFloat(creating.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      throw new Error("Valid latitude and longitude are required.");
    if (!isValidLatitude(lat) || !isValidLongitude(lng))
      throw new Error(
        "Latitude must be between -90 and 90, and longitude between -180 and 180.",
      );
    const c = await createPlace({
      name: creating.name.trim(),
      latitude: lat,
      longitude: lng,
      // Creating a place INLINE from a trip log, by typing a name that matches
      // nothing. Canyon deliberately, and not a picker: the user is logging a
      // trip, not filing a place, and interrupting that with a type question
      // to answer a name they already typed is the wrong moment. The type is
      // one tap to change on the place itself afterwards.
      placeTypeId: SYSTEM_PLACE_TYPE_IDS.canyon,
    });
    onPlaceCreated?.();
    return [...selectedPlaceIds, c.id];
  }

  // The trip id media should link to: a real trip in edit mode, otherwise a
  // draft created on first upload. Guarded so concurrent uploads create one trip.
  function ensureLinkedTripId(): Promise<string> {
    if (tripLog) return Promise.resolve(tripLog.id);
    if (draftTripId) return Promise.resolve(draftTripId);
    if (draftPromiseRef.current) return draftPromiseRef.current;

    const customFields: Record<string, unknown> = {};
    for (const def of visibleFieldDefs) {
      customFields[def.key] = coerceFieldValue(
        getFieldValue(def.key),
        def.type,
      );
    }
    // placeIds and displayName are independent — an empty/unnamed draft is
    // valid (derives "Untitled trip" until the user fills in either).
    const promise = createTripLog({
      date,
      notes: notes || null,
      customFields,
      placeIds: selectedPlaceIds,
      displayName: displayNameInput.trim() || null,
      types: selectedTypes,
    })
      .then((trip) => {
        setDraftTripId(trip.id);
        return trip.id;
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
  }

  function handleMediaDeleted(id: string) {
    setMedia((prev) => prev.filter((m) => m.id !== id));
  }

  // "Log a trip" on a track: the track goes into the form as a copy of its file
  // on the draft trip, the same way a file the user drops here does, so it can
  // be taken out again and a Cancel deletes it with the draft. Once per open.
  // The form state it reads is the populate's, which was set during render.
  const [attachingTrack, setAttachingTrack] = useState(false);
  const attachedSessionRef = useRef(-1);
  useEffect(() => {
    if (!open || tripLog || !fromTrack) return;
    if (attachedSessionRef.current === formSession) return;
    attachedSessionRef.current = formSession;
    setAttachingTrack(true);
    void (async () => {
      try {
        const { items } = await getMediaDownloadUrls([fromTrack.mediaId]);
        const url = items[0]?.displayUrl;
        if (!url) throw new Error("The file could not be fetched.");
        const response = await fetch(url);
        if (!response.ok) throw new Error("The file could not be fetched.");
        const file = new File([await response.blob()], fromTrack.filename);
        const resolved = resolveMediaType(file);
        if (!resolved) throw new Error("Unsupported track file.");
        const tripId = await ensureLinkedTripId();
        const item = await uploadMedia({
          linkedType: "tripLog",
          linkedId: tripId,
          file,
          mediaType: resolved.mediaType,
          thumbnail: await generateThumbnail(file, resolved.category),
        });
        setMedia((prev) => [...prev, item]);
      } catch (err) {
        console.error(err);
        setError(
          messageFromError(
            err,
            "Couldn't add the track to this trip. You can add it below.",
          ),
        );
      } finally {
        setAttachingTrack(false);
      }
    })();
    // The attach runs once per open (formSession); the form's own state is read
    // as it is at that moment, not re-run when it changes.
  }, [open, tripLog, fromTrack, formSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel/close. If a draft trip was materialised but never saved, delete it
  // (cascades its media from S3 + DB + quota) before closing.
  async function handleRequestClose() {
    if (saving) return;
    if (draftTripId && !committedRef.current) {
      try {
        await deleteTripLog(draftTripId);
      } catch (err) {
        console.error(err);
        setError(
          messageFromError(
            err,
            "Couldn't discard uploaded files. Please try again.",
          ),
        );
        return;
      }
    }
    onClose();
  }

  const guard = useUnsavedChangesGuard(
    isDirty,
    () => void handleRequestClose(),
  );

  function getFieldValue(key: string): string {
    return fieldValues[key] ?? "";
  }

  function setFieldValue(key: string, value: string) {
    setKeptFieldKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  function removeLeftoverField(key: string) {
    setKeptFieldKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setFieldValues((prev) => ({ ...prev, [key]: "" }));
  }

  function handlePickCoords() {
    if (!onPickCoords) return;
    setPicking(true);
    onPickCoords((lat, lng) => {
      setCreating((prev) =>
        prev
          ? { ...prev, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }
          : { name: "", latitude: lat.toFixed(6), longitude: lng.toFixed(6) },
      );
    });
  }

  // ── Places, a mode of this dialog ──────────────────────────────────────
  const selectedCount = selectedPlaceIds.length + (creating ? 1 : 0);
  const needle = placeSearch.trim().toLowerCase();
  const pinnedPlaces = selectedPlaceIds
    .map((id) => places.find((place) => place.id === id))
    .filter((place): place is TPlace => !!place);
  const matches = places.filter(
    (place) =>
      !selectedPlaceIds.includes(place.id) &&
      place.name.toLowerCase().includes(needle),
  );

  function openPlacesPicker() {
    setPlaceSearch("");
    setPlacesError(null);
    setMode("places");
  }

  function backToForm() {
    setMode("form");
    setPlacesError(null);
    // After the form is shown again: focus goes back to the field that opened
    // the picker rather than to the top of the dialog.
    requestAnimationFrame(() =>
      placesFieldRef.current?.querySelector("button")?.focus(),
    );
  }

  // Order is kept: a trip's place order is what its derived title reads, so
  // "Claustral and Ranon" is a different title from "Ranon and Claustral".
  function togglePlace(id: string) {
    setPlacesError(null);
    if (selectedPlaceIds.includes(id)) {
      setSelectedPlaceIds(selectedPlaceIds.filter((other) => other !== id));
      return;
    }
    if (selectedCount >= MAX_PLACES_PER_TRIP) {
      setPlacesError(`A trip can have at most ${MAX_PLACES_PER_TRIP} places.`);
      return;
    }
    setSelectedPlaceIds([...selectedPlaceIds, id]);
  }

  function startCreate(name: string) {
    if (selectedCount >= MAX_PLACES_PER_TRIP) {
      setPlacesError(`A trip can have at most ${MAX_PLACES_PER_TRIP} places.`);
      return;
    }
    setCreating({
      name,
      latitude: creating?.latitude ?? "",
      longitude: creating?.longitude ?? "",
    });
    setPlaceSearch("");
  }

  // ── Types ──────────────────────────────────────────────────────────────
  // The vocabulary in a stable order — seeds, then the user's history, then
  // types added here — each shown in the casing the SELECTION uses, so a picked
  // "Canyoning" lights the seeded "canyoning" chip instead of adding a second.
  const typeOptions = useMemo(() => {
    const vocabulary = dedupeTypesPreserveCase([
      ...TRIP_TYPE_SUGGESTIONS,
      ...existingTripTypes,
      ...addedTypes,
    ]);
    const values = vocabulary.map(
      (type) =>
        selectedTypes.find(
          (picked) => picked.toLowerCase() === type.toLowerCase(),
        ) ?? type,
    );
    for (const picked of selectedTypes) {
      if (!values.some((value) => value.toLowerCase() === picked.toLowerCase()))
        values.push(picked);
    }
    return values.map((value) => {
      const look = tripTypeLook(value);
      return {
        value,
        label: tripTypeLabel(value),
        icon: look.icon,
        hue: look.hue,
      };
    });
  }, [existingTripTypes, addedTypes, selectedTypes]);

  // The canyoning tag is locked (shown, not removable) while a place is linked
  // — the API re-adds it on save, so offering to remove it would be a lie.
  // Unlink the places and it becomes an ordinary tag.
  const lockedTypes = useMemo(
    () =>
      new Set(
        linkedCanyon
          ? typeOptions
              .filter(
                (option) => option.value.toLowerCase() === CANYONING_TRIP_TYPE,
              )
              .map((option) => option.value)
          : [],
      ),
    [linkedCanyon, typeOptions],
  );

  function toggleType(value: string) {
    setTypesError(null);
    if (selectedTypes.includes(value)) {
      setSelectedTypes(
        enforceCanyoningTag(
          selectedTypes.filter((type) => type !== value),
          linkedCanyon,
        ),
      );
      return;
    }
    if (selectedTypes.length >= MAX_TRIP_TYPES_PER_TRIP) {
      setTypesError(
        `A trip can have at most ${MAX_TRIP_TYPES_PER_TRIP} types.`,
      );
      return;
    }
    setSelectedTypes([...selectedTypes, value]);
  }

  // Case-insensitive: adding "Canyoning" over "canyoning" picks the existing
  // chip, because the API rejects case-variant duplicates.
  function addType(label: string) {
    const existing = typeOptions.find(
      (option) => option.value.toLowerCase() === label.toLowerCase(),
    );
    const value = existing?.value ?? label;
    setAddedTypes((current) =>
      current.some((type) => type.toLowerCase() === value.toLowerCase())
        ? current
        : [...current, value],
    );
    if (!selectedTypes.includes(value)) toggleType(value);
  }

  const typesHint =
    [
      linkedCanyon
        ? "Trips with a linked canyon are always tagged canyoning."
        : null,
      selectedTypes.length > 1
        ? "The starred type sets the trip’s icon."
        : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  // Enter-to-submit. This repeats the Save button's `disabled` condition on
  // purpose: a form still submits on Enter while its submit button is disabled,
  // so the precondition has to be enforced here too or Enter becomes a way
  // around it (notably a second save while one is already in flight). The Save
  // button is `type="submit"` with no onClick, so pointer and keyboard share
  // this single path and cannot both fire for one interaction.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !date) return;
    void handleSave();
  }

  async function handleSave() {
    if (!date) {
      setError("Date is required.");
      return;
    }
    // Block save if any custom numeric field is invalid (e.g. "5.5" in an
    // integer field) so it can't be silently mangled on save (TRIP-1/TRIP-2).
    const customFieldInvalid = visibleFieldDefs.some(
      (def) => customFieldValueError(def, getFieldValue(def.key)) != null,
    );
    if (customFieldInvalid) {
      setShowFieldErrors(true);
      setError("Please fix the highlighted fields.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Resolve place selection (may create a place inline)
      const placeIds = await resolvePlaceIds();
      const displayName = displayNameInput.trim() || null;
      const types = selectedTypes;

      // Only the fields the form actually showed. A definition scoped to a
      // type this trip does not visit is not "empty" here — it was never asked,
      // and writing a null for it would be this form inventing an answer.
      const customFields: Record<string, unknown> = {};
      for (const def of visibleFieldDefs) {
        const raw = getFieldValue(def.key);
        customFields[def.key] = coerceFieldValue(raw, def.type);
      }

      if (tripLog) {
        await updateTripLog(tripLog.id, {
          date,
          notes: notes || null,
          customFields,
          placeIds,
          displayName,
          types,
        });
      } else if (draftTripId) {
        // A draft was already created to hold uploaded files — persist the form.
        await updateTripLog(draftTripId, {
          date,
          notes: notes || null,
          customFields,
          placeIds,
          displayName,
          types,
        });
      } else {
        await createTripLog({
          date,
          notes: notes || null,
          customFields,
          placeIds,
          displayName,
          types,
        });
      }
      committedRef.current = true;
      // The trip is persisted server-side; the local draft has done its job.
      // Only in create mode — in edit mode the slot holds an unrelated create
      // draft that this save says nothing about.
      if (!tripLog) clearTripDraft();
      onSaved();
      toast.success(tripLog ? "Trip updated." : "Trip logged.");
      onClose();
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(err, "Couldn't save this trip. Please try again."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAddField() {
    const result = buildCustomFieldDef(
      {
        label: newFieldLabel,
        type: newFieldType,
        bounded: newFieldBounded,
        min: newFieldMin,
        max: newFieldMax,
      },
      customFieldDefs,
    );
    if ("error" in result) {
      setAddFieldError(result.error);
      return;
    }
    setAddingField(true);
    setAddFieldError(null);
    try {
      // ROW-GRAIN, not a whole-list PATCH: definitions are rows, and the list
      // write would have wiped the scoping off every one of them. The server
      // returns the surviving list, so this uses the server's answer rather
      // than a locally-appended guess.
      //
      // `appliesToAllTypes` because Logjam Web has no trip-type picker for a
      // new field yet — a field named for no trip type would otherwise appear
      // on no trip at all. Logjam GPS offers the picker.
      const updatedDefs = await createCustomField("trip-log", result.def, {
        appliesToAllTypes: true,
      });
      onCustomFieldDefsChange(updatedDefs);
      setShowAddField(false);
      setNewFieldLabel("");
      setNewFieldType("string");
      setNewFieldBounded(false);
      setNewFieldMin("");
      setNewFieldMax("");
    } catch (err) {
      console.error(err);
      setAddFieldError(
        messageFromError(err, "Couldn't save the attribute. Please try again."),
      );
    } finally {
      setAddingField(false);
    }
  }

  const derivedTitle = formatTripPlaceNames(selectedPlaceNames);

  return (
    <>
      <Dialog
        open={open}
        title={
          mode === "places"
            ? "Places on this trip"
            : tripLog
              ? "Edit trip"
              : "Log a trip"
        }
        size="large"
        dismissible={!saving}
        // Inside the picker, every way out means "back to the form" — not
        // "throw away everything I just typed".
        onClose={mode === "places" ? backToForm : guard.requestClose}
        footer={
          mode === "places" ? (
            <Button variant="filled" icon="done" onClick={backToForm}>
              Done
            </Button>
          ) : (
            <>
              {/* Not "Cancel": the add-attribute sub-form renders its own
                  "Cancel" that only backs out of that sub-form, and both can be
                  on screen at once — two identical words, opposite scopes. In
                  edit mode the object is the *changes*, not the trip: "Discard
                  trip" on a saved trip would read as "delete it from my
                  logbook". */}
              <Button onClick={guard.requestClose} disabled={saving}>
                {tripLog ? "Discard changes" : "Discard trip"}
              </Button>
              {/* type="submit" with no onClick — handleSubmit is the only save
                  path, so a click can't fire alongside the form's submit. */}
              <Button
                type="submit"
                form={formId}
                variant="filled"
                busy={saving}
                disabled={!date || attachingTrack}
              >
                {tripLog ? "Save changes" : "Log trip"}
              </Button>
            </>
          )
        }
      >
        {mode === "places" && (
          <div className={classes.picker}>
            <SearchField
              label="Search your places"
              value={placeSearch}
              // eslint-disable-next-line no-restricted-syntax -- mounts after the dialog is open, where autoFocus works
              autoFocus
              onChange={(event) => {
                setPlaceSearch(event.target.value);
                setPlacesError(null);
              }}
              onKeyDown={(event) => {
                // Enter takes the obvious one: the first match, or the new place
                // when nothing matches. Never the dialog's submit.
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (matches[0]) togglePlace(matches[0].id);
                else if (needle && !creating) startCreate(placeSearch.trim());
              }}
            />
            <FieldError message={placesError} />
            {selectedCount > 0 && (
              <section className={classes.section}>
                <SectionHeader title="On this trip" count={selectedCount} />
                {pinnedPlaces.map((place, index) => (
                  <Row
                    key={place.id}
                    className={classes.row}
                    title={place.name}
                    subtitle={`${index + 1} of ${selectedCount}`}
                    description="On this trip. Press to take it off."
                    leading={<IconTile icon="done" hue="var(--color-accent)" />}
                    onOpen={() => togglePlace(place.id)}
                  />
                ))}
                {creating && (
                  <Row
                    className={classes.row}
                    title={creating.name || "New place"}
                    subtitle={`${selectedCount} of ${selectedCount} · made when the trip is saved`}
                    description="A new place. Press to take it off."
                    leading={
                      <IconTile icon="addPlace" hue="var(--color-accent)" />
                    }
                    onOpen={() => setCreating(null)}
                  />
                )}
              </section>
            )}
            <section className={classes.section}>
              <SectionHeader
                title={needle ? "Matches" : "Your places"}
                count={matches.length}
              />
              {needle && !creating && (
                <Row
                  className={classes.row}
                  title={`Create “${placeSearch.trim()}”`}
                  subtitle="A new canyon, made when the trip is saved"
                  leading={
                    <IconTile icon="addPlace" hue="var(--color-neutral)" />
                  }
                  onOpen={() => startCreate(placeSearch.trim())}
                />
              )}
              {matches.length === 0 ? (
                <p className={classes.muted}>
                  {places.length === 0
                    ? "No places yet. You can log the trip now and link a place later."
                    : "Nothing matches that name."}
                </p>
              ) : (
                matches.map((place) => (
                  <Row
                    key={place.id}
                    className={classes.row}
                    title={place.name}
                    description="Press to add it to this trip."
                    leading={<IconTile icon="add" hue="var(--color-neutral)" />}
                    onOpen={() => togglePlace(place.id)}
                  />
                ))
              )}
            </section>
          </div>
        )}

        {/* Hidden rather than unmounted while the picker is up, so an upload in
            flight and a half-typed attribute survive the trip there and back.
            The form spans the whole body; its Save lives in the footer and is
            tied to it by id, so Enter in any field saves. */}
        <form
          id={formId}
          noValidate
          onSubmit={handleSubmit}
          className={classes.form}
          hidden={mode !== "form"}
        >
          {/* Autosaved-draft offer. An offer rather than a silent repopulate:
              the form stays fresh until the user asks for the draft back, so
              nobody has to work out why last Tuesday's text is in today's
              trip. Carries only a timestamp — no place names, no notes — so
              the prompt itself can't leak the payload. */}
          {restorableDraft && (
            <div role="status" className={classes.draft}>
              <p className={classes.draftText}>
                You have an unsaved trip from{" "}
                {formatDraftSavedAt(restorableDraft.savedAt)}.
              </p>
              <div className={classes.draftActions}>
                <Button compact onClick={handleDiscardDraft}>
                  Discard
                </Button>
                <Button compact variant="outline" onClick={handleRestoreDraft}>
                  Restore
                </Button>
              </div>
            </div>
          )}

          <TextField
            data-autofocus={focusDateOnOpen || undefined}
            label="Date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            error={date ? null : "Date is required."}
            // Non-blocking — a future date is allowed (trip planning), it is
            // only flagged so an accidental typo doesn't pass unnoticed.
            hint={
              isFutureDate(date) ? "This date is in the future." : undefined
            }
          />

          <div ref={placesFieldRef} className={classes.field}>
            <span className={classes.fieldLabel} aria-hidden>
              Places
            </span>
            <Row
              className={classes.row}
              title={derivedTitle ?? "No places linked"}
              subtitle={
                selectedCount === 1 ? "1 place" : `${selectedCount} places`
              }
              description="Places on this trip. Press to choose."
              leading={<IconTile icon="place" hue="var(--color-accent)" />}
              trailing={
                <Icon
                  idea="disclosure"
                  size={18}
                  aria-hidden
                  className={classes.chevron}
                />
              }
              onOpen={openPlacesPicker}
            />
            {/* The new place's position: typed, or picked on the map. The name
                is what was typed in the picker. */}
            {creating && (
              <div className={classes.createPlace}>
                <p className={classes.muted}>
                  Where is{" "}
                  {creating.name ? `“${creating.name}”` : "the new place"}?
                </p>
                <div className={classes.coordinates}>
                  <TextField
                    label="Latitude"
                    className={classes.grow}
                    inputMode="decimal"
                    placeholder="-33.123456"
                    value={creating.latitude}
                    onChange={(event) =>
                      setCreating((prev) =>
                        prev ? { ...prev, latitude: event.target.value } : prev,
                      )
                    }
                  />
                  <TextField
                    label="Longitude"
                    className={classes.grow}
                    inputMode="decimal"
                    placeholder="150.123456"
                    value={creating.longitude}
                    onChange={(event) =>
                      setCreating((prev) =>
                        prev
                          ? { ...prev, longitude: event.target.value }
                          : prev,
                      )
                    }
                  />
                  {onPickCoords && (
                    <Button
                      variant="outline"
                      icon="addPlace"
                      onClick={handlePickCoords}
                    >
                      Pick on map
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Overrides the derived title (the joined place names). */}
          <TextField
            label="Title"
            value={displayNameInput}
            onChange={(event) => setDisplayNameInput(event.target.value)}
            hint={
              displayNameInput.trim()
                ? undefined
                : `Defaults to ${derivedTitle ?? "“Untitled trip”"}`
            }
          />

          <ChipPicker
            label="Type"
            options={typeOptions}
            selected={selectedTypes}
            onToggle={toggleType}
            onAdd={addType}
            addLabel="Add a type"
            lockedValues={lockedTypes}
            primaryValue={
              selectedTypes.length > 1
                ? (primaryTripType(selectedTypes) ?? undefined)
                : undefined
            }
            hint={typesHint}
            error={typesError}
          />

          <TextArea
            label="Notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Conditions, observations…"
          />

          <section className={classes.section}>
            <SectionHeader title="Trip attributes" />
            {askedFieldDefs.map((def) => (
              <div key={def.key} className={classes.attribute}>
                <div className={classes.grow}>
                  <CustomFieldInput
                    def={def}
                    value={getFieldValue(def.key)}
                    onChange={(value) => setFieldValue(def.key, value)}
                    showError={showFieldErrors}
                  />
                </div>
                <IconButton
                  icon="delete"
                  label={`Delete the attribute ${def.label}`}
                  tone="danger"
                  onClick={() => setFieldToDelete(def)}
                />
              </div>
            ))}
            {showAddField ? (
              <AddCustomFieldForm
                label={newFieldLabel}
                onLabelChange={setNewFieldLabel}
                type={newFieldType}
                onTypeChange={setNewFieldType}
                onAdd={handleAddField}
                onCancel={() => {
                  setShowAddField(false);
                  setNewFieldLabel("");
                  setNewFieldBounded(false);
                  setNewFieldMin("");
                  setNewFieldMax("");
                  setAddFieldError(null);
                }}
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
                icon="add"
                className={classes.addAttribute}
                onClick={() => setShowAddField(true)}
              >
                Add an attribute
              </Button>
            )}
          </section>

          {/* Not a place's "Doesn't fit this type" and its three actions:
              these are the user's own definitions, so there is nothing to
              adopt — only keep or remove. The same card row, though, so the
              two read as the same kind of thing. */}
          {leftoverFieldDefs.length > 0 && (
            <section className={classes.section}>
              <SectionHeader
                title="Leftover attributes"
                count={leftoverFieldDefs.length}
              />
              <p className={classes.muted}>
                These attributes are left over from when this trip was saved as
                a different type.
              </p>
              {leftoverFieldDefs.map((def) => (
                <Row
                  key={def.key}
                  leading={<IconTile icon="help" hue="var(--color-accent)" />}
                  title={def.label}
                  subtitle={formatFieldValue(
                    coerceFieldValue(getFieldValue(def.key), def.type),
                    def.type,
                  )}
                  trailing={
                    <IconButton
                      icon="close"
                      label={`Remove ${def.label} from this trip`}
                      onClick={() => removeLeftoverField(def.key)}
                    />
                  }
                />
              ))}
            </section>
          )}

          {/* Media. In create mode the first upload lazily creates a draft trip
              to link files to; discarding deletes it (and its files). */}
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
              linkedType="tripLog"
              linkedId={tripLog ? tripLog.id : ""}
              resolveLinkedId={tripLog ? undefined : ensureLinkedTripId}
              onUploaded={handleMediaUploaded}
              disabled={saving}
            />
          </section>

          <section className={classes.section}>
            <SectionHeader title="Tracks" />
            {attachingTrack && (
              <p className={classes.muted} role="status">
                Adding the track…
              </p>
            )}
            {!mediaLoading && (
              <MediaGallery
                media={media}
                variant="tracks"
                canDelete
                onDeleted={handleMediaDeleted}
                emptyText="No tracks yet."
              />
            )}
            <MediaUpload
              category="track"
              linkedType="tripLog"
              linkedId={tripLog ? tripLog.id : ""}
              resolveLinkedId={tripLog ? undefined : ensureLinkedTripId}
              onUploaded={handleMediaUploaded}
              disabled={saving}
            />
          </section>

          {error && <ErrorBanner message={error} />}
        </form>
      </Dialog>

      {/* Impact-aware delete confirm (shared with Settings). On delete the
          server strips the field's values from all trips; mirror that locally
          by dropping the form value. */}
      <DeleteCustomFieldDialog
        entity="trip-log"
        def={fieldToDelete}
        onClose={() => setFieldToDelete(null)}
        onDeleted={(remaining) => {
          onCustomFieldDefsChange(remaining);
          if (fieldToDelete) {
            const { key } = fieldToDelete;
            setFieldValues((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
          }
        }}
      />

      <ConfirmDialog
        open={guard.guardOpen}
        title="Discard unsaved changes?"
        message="Your changes will be lost."
        confirmLabel="Discard"
        confirmColor="error"
        onConfirm={() => {
          // "Discard" is the deliberate answer the autosaved draft can't
          // second-guess — the whole point of the prompt is that the user means
          // it. Create mode only: discarding *edits* to a saved trip must not
          // take an unrelated create draft with it.
          if (!tripLog) clearTripDraft();
          guard.confirmDiscard();
        }}
        onClose={guard.cancelDiscard}
      />
    </>
  );
}

export default TripLogDialog;
