import { useState, useEffect, useRef, useMemo } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Autocomplete,
  Button,
  IconButton,
  TextField,
  Typography,
  Box,
  Chip,
  CircularProgress,
  createFilterOptions,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { useToast } from "../feedback/ToastProvider";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import type { TripLogCustomFieldDef, TripLogCustomFieldType, MediaItem } from "@logjam/shared";
import {
  coerceFieldValue,
  buildCustomFieldDef,
  formatTripCanyonNames,
  isValidLatitude,
  isValidLongitude,
  TRIP_TYPE_SUGGESTIONS,
  MAX_CANYONS_PER_TRIP,
  MAX_TRIP_TYPES_PER_TRIP,
  CANYONING_TRIP_TYPE,
  enforceCanyoningTag,
} from "@logjam/shared";
import type { TCanyon, TTripLog } from "../../canyonUtils";
import {
  createTripLog,
  updateTripLog,
  deleteTripLog,
  getTripLog,
  createCanyon,
  updateUserPreferences,
} from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import {
  clearTripDraft,
  readTripDraft,
  tripFormFingerprint,
  writeTripDraft,
  type TripDraft,
  type TripDraftForm,
} from "../../tripDraft";
import {
  fieldSx,
  typeChipSx,
  touchTargetSx,
  dialogActionButtonSx,
  NOTES_MAX_ROWS,
} from "../../csvImport/dialogStyles";
import MediaUpload from "../media/MediaUpload";
import MediaGallery from "../media/MediaGallery";
import AddCustomFieldForm from "./AddCustomFieldForm";
import CustomFieldInput, { customFieldValueError } from "./CustomFieldInput";
import DeleteCustomFieldDialog from "./DeleteCustomFieldDialog";
import ConfirmDialog from "./ConfirmDialog";
import { getFieldValue as getFieldValueFor } from "./customFieldValues";
import classes from "./TripLogDialog.module.css";

function todayDateString(): string {
  // Today's LOCAL calendar date as YYYY-MM-DD. The trip date comes from a native
  // <input type="date">, which yields a local calendar date, so "today" must be
  // local too — `toISOString()` (UTC) marked the current day as "future" every
  // morning in AEST (UTC+10/+11).
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// True when a date-only string (YYYY-MM-DD) is after today. Both sides are
// local-calendar YYYY-MM-DD strings, so this is a plain lexicographic
// comparison with no timezone off-by-one.
function isFutureDate(dateString: string): boolean {
  return dateString > todayDateString();
}

// ── Canyon option union ──────────────────────────────────────
// "no-marker" (name-only, no canyon) is gone — an empty selection plus the
// trip name field covers that case now that canyons[] and displayName are
// independent.
type CanyonOption =
  | { kind: "existing"; canyon: TCanyon }
  | { kind: "create"; name: string };

function getOptionLabel(opt: CanyonOption | string): string {
  if (typeof opt === "string") return opt;
  switch (opt.kind) {
    case "existing":
      return opt.canyon.name;
    case "create":
      return opt.name;
  }
}

const canyonFilter = createFilterOptions<CanyonOption>();

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

// ── Type option union ────────────────────────────────────────
// Mirrors the Canyons picker: existing suggestions plus a synthetic
// `Add "<input>"` row when the typed text matches nothing.
type TypeOption =
  | { kind: "existing"; label: string }
  | { kind: "new"; label: string };

const typeFilter = createFilterOptions<TypeOption>();

function getTypeOptionLabel(opt: TypeOption | string): string {
  return typeof opt === "string" ? opt : opt.label;
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

function TripLogDialog({
  open,
  onClose,
  onSaved,
  canyons,
  defaultCanyonId = null,
  tripLog,
  customFieldDefs,
  onCustomFieldDefsChange,
  existingTripTypes,
  onPickCoords,
  onCanyonCreated,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  canyons: TCanyon[];
  // Create-mode default selection (e.g. the canyon whose detail panel opened the
  // dialog) — seeds the initial multi-selection. Edit mode always uses the
  // trip's own canyons. Defaults to none.
  defaultCanyonId?: string | null;
  tripLog?: TTripLog;
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
  // Raw (non-deduped) trip.types values flattened from whichever trip list the
  // caller has on hand — unioned with TRIP_TYPE_SUGGESTIONS for the types
  // field's autocomplete options.
  existingTripTypes: string[];
  onPickCoords?: (onPicked: (lat: number, lng: number) => void) => void;
  // Fired when an inline "Create new canyon" makes a real canyon, so the parent
  // can refetch the canyon list/map (otherwise the new marker only shows after a
  // manual refresh).
  onCanyonCreated?: () => void;
}) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [date, setDate] = useState(todayDateString());
  const [notes, setNotes] = useState("");
  // Ordered ids of selected existing canyons — order is meaningful (drives the
  // derived title placeholder).
  const [selectedCanyonIds, setSelectedCanyonIds] = useState<string[]>([]);
  // User's trip-name override. "" means unset (falls back to the derived
  // placeholder); independent of canyon selection.
  const [displayNameInput, setDisplayNameInput] = useState("");
  // Ordered selected trip types (user vocab, case preserved as typed) —
  // capped at MAX_TRIP_TYPES_PER_TRIP, deduped case-insensitively on add.
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  // At most one pending inline "create new canyon" at a time (mirrors the old
  // single-canyon dialog's one-create-at-a-time behaviour).
  const [creating, setCreating] = useState<CreateForm | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set on a Save attempt so every invalid custom field shows its inline error
  // at once (before that, errors only show after a field is blurred).
  const [showFieldErrors, setShowFieldErrors] = useState(false);

  // Linking a canyon means "I did that canyon on this trip", so the API
  // force-tags `canyoning` on save. Mirror that in the selection itself (rather
  // than only in the rendered chips) so the tag is visible before the user hits
  // Save instead of appearing afterwards, and so the cap checks below count it
  // exactly as storage does. enforceCanyoningTag returns its input unchanged
  // when there's nothing to add, so this settles immediately.
  const hasLinkedCanyon = selectedCanyonIds.length > 0;
  useEffect(() => {
    setSelectedTypes((prev) => enforceCanyoningTag(prev, hasLinkedCanyon));
  }, [hasLinkedCanyon]);

  // The full known-type vocabulary: built-in suggestions ∪ the user's own
  // history, deduped case-insensitively (first casing wins).
  const knownTypes = useMemo(
    () => dedupeTypesPreserveCase([...TRIP_TYPE_SUGGESTIONS, ...existingTripTypes]),
    [existingTripTypes],
  );

  // Dropdown options — known types minus the already-selected ones, so a
  // chipped type doesn't linger (duplicated) in the list.
  const typeOptions: TypeOption[] = useMemo(() => {
    const selected = new Set(selectedTypes.map((t) => t.toLowerCase()));
    return knownTypes
      .filter((t) => !selected.has(t.toLowerCase()))
      .map((label) => ({ kind: "existing" as const, label }));
  }, [knownTypes, selectedTypes]);

  // The current selection rendered as Autocomplete chips, in selection order.
  const typeValue: TypeOption[] = useMemo(
    () => selectedTypes.map((label) => ({ kind: "existing" as const, label })),
    [selectedTypes],
  );

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
  const pickingRef = useRef(false);
  // First field, focused on a fresh open by the reset effect below.
  const canyonInputRef = useRef<HTMLInputElement>(null);

  // Add custom field form state
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<TripLogCustomFieldType>("string");
  const [newFieldBounded, setNewFieldBounded] = useState(false);
  const [newFieldMin, setNewFieldMin] = useState("");
  const [newFieldMax, setNewFieldMax] = useState("");
  const [addingField, setAddingField] = useState(false);
  const [addFieldError, setAddFieldError] = useState<string | null>(null);
  // Field pending deletion via the shared impact-aware confirm (also used by
  // the Account panel's field manager).
  const [fieldToDelete, setFieldToDelete] = useState<TripLogCustomFieldDef | null>(null);

  // Selectable canyons — already-selected ones are excluded so they don't
  // linger (duplicated) in the dropdown once chipped.
  const canyonOptions: CanyonOption[] = useMemo(
    () =>
      canyons
        .filter((c) => !selectedCanyonIds.includes(c.id))
        .map((c) => ({ kind: "existing" as const, canyon: c })),
    [canyons, selectedCanyonIds],
  );

  // The current selection rendered as Autocomplete chips, in selection order.
  // The pending inline-create (if any) always renders last.
  const canyonValue: CanyonOption[] = useMemo(() => {
    const chips: CanyonOption[] = selectedCanyonIds
      .map((id) => canyons.find((c) => c.id === id))
      .filter((c): c is TCanyon => !!c)
      .map((c) => ({ kind: "existing" as const, canyon: c }));
    if (creating) chips.push({ kind: "create", name: creating.name });
    return chips;
  }, [selectedCanyonIds, canyons, creating]);

  // Names of the currently selected canyons (incl. a pending create, for a live
  // placeholder preview), in selection order — feeds the trip-name placeholder.
  const selectedCanyonNames = useMemo(() => {
    const names = selectedCanyonIds
      .map((id) => canyons.find((c) => c.id === id)?.name)
      .filter((n): n is string => !!n);
    if (creating?.name) names.push(creating.name);
    return names;
  }, [selectedCanyonIds, canyons, creating]);

  // Snapshot of the form fields as populated below, taken in the same effect
  // that sets them — used by the unsaved-changes guard to tell a real edit
  // apart from "the dialog is open" (TRIP-3). Moves when the form is
  // re-populated, which includes restoring a draft.
  const initialFormSnapshotRef = useRef<string | null>(null);
  // Snapshot of a *fresh* form, taken only on open and never re-taken. The two
  // baselines answer different questions and must not be merged:
  //   initialFormSnapshot → "would closing lose work done since the form was
  //     populated?" (the guard's question — a just-restored draft answers no)
  //   pristineFormSnapshot → "is there anything here worth persisting?"
  //     (the draft's question — a just-restored draft answers yes)
  const pristineFormSnapshotRef = useRef<string | null>(null);
  // A restorable draft found on open, awaiting the user's restore/discard
  // answer. Non-null suppresses autosave, so ignoring the offer and typing
  // can't overwrite the very draft being offered. Create mode only.
  const [restorableDraft, setRestorableDraft] = useState<TripDraft | null>(null);
  // The same fact as `restorableDraft`, in a ref, because the autosave effect
  // needs it *synchronously*. Both effects run in one commit and this one is
  // declared second, so on the pass that opens the dialog it would still read
  // `restorableDraft === null` from state and arm a timer against last
  // session's un-flushed form values — which could clear the draft it is about
  // to offer. The re-render normally cancels that timer long before it fires,
  // but "normally" is a race, and losing the draft is the failure this whole
  // module exists to prevent. The ref is set before the timer is ever armed.
  const draftOfferPendingRef = useRef(false);
  // One autosave-failure toast per open, not one per keystroke.
  const draftWarnedRef = useRef(false);

  // Populate form when opening for edit (or reset on create).
  // We intentionally exclude customFieldDefs from deps — field defs shouldn't
  // reset the form values just because a new field was added mid-session.
  useEffect(() => {
    if (!open) return;
    // Returning from a pick-on-map cycle — don't reset form state.
    if (pickingRef.current) {
      pickingRef.current = false;
      return;
    }
    let initialDate: string;
    let initialNotes: string;
    let initialSelectedCanyonIds: string[];
    let initialDisplayNameInput: string;
    let initialSelectedTypes: string[];
    let initialFieldValues: Record<string, string>;
    if (tripLog) {
      initialDate = tripLog.date.split("T")[0];
      initialNotes = tripLog.notes ?? "";
      initialSelectedCanyonIds = tripLog.canyons.map((c) => c.id);
      initialDisplayNameInput = tripLog.displayName ?? "";
      // Enforce here rather than letting the effect below do it, so the
      // unsaved-changes snapshot taken next already includes the tag — a trip
      // that predates enforcement would otherwise read as dirty the instant it
      // opened, and prompt on close without the user touching anything.
      initialSelectedTypes = enforceCanyoningTag(
        tripLog.types,
        initialSelectedCanyonIds.length > 0,
      );
      // Populate existing custom field values as strings
      const vals: Record<string, string> = {};
      for (const def of customFieldDefs) {
        const raw = tripLog.customFields[def.key];
        vals[def.key] = raw != null ? String(raw) : "";
      }
      initialFieldValues = vals;
    } else {
      initialDate = todayDateString();
      initialNotes = "";
      initialSelectedCanyonIds = defaultCanyonId ? [defaultCanyonId] : [];
      initialDisplayNameInput = "";
      initialSelectedTypes = enforceCanyoningTag(
        [],
        initialSelectedCanyonIds.length > 0,
      );
      initialFieldValues = {};
    }
    setDate(initialDate);
    setNotes(initialNotes);
    setSelectedCanyonIds(initialSelectedCanyonIds);
    setDisplayNameInput(initialDisplayNameInput);
    setSelectedTypes(initialSelectedTypes);
    setCreating(null);
    setFieldValues(initialFieldValues);
    const initialFingerprint = tripFormFingerprint({
      date: initialDate,
      notes: initialNotes,
      selectedCanyonIds: initialSelectedCanyonIds,
      displayNameInput: initialDisplayNameInput,
      selectedTypes: initialSelectedTypes,
      fieldValues: initialFieldValues,
      creating: null,
    });
    initialFormSnapshotRef.current = initialFingerprint;
    pristineFormSnapshotRef.current = initialFingerprint;
    // Offer any autosaved draft rather than restoring it silently: someone who
    // opened this to log today's trip would otherwise find last Tuesday's text
    // already typed and have to work out where it came from. Edit mode never
    // reads the draft — it holds a create form, and pouring it into an existing
    // trip would overwrite a saved one (tripDraft.ts re-checks `mode` too).
    const foundDraft = tripLog ? null : readTripDraft(new Date());
    draftOfferPendingRef.current = foundDraft !== null;
    setRestorableDraft(foundDraft);
    draftWarnedRef.current = false;
    setError(null);
    setShowFieldErrors(false);
    setShowAddField(false);
    setNewFieldLabel("");
    setNewFieldType("string");
    // Reset media/draft tracking each time the dialog opens.
    setMedia([]);
    setDraftTripId(null);
    committedRef.current = false;
    draftPromiseRef.current = null;

    // Open ready to type, focusing the first field. Driven from here rather
    // than an `autoFocus` prop because the decision depends on `foundDraft`,
    // which only exists on this line: `restorableDraft` is state, so during the
    // render that mounts the field it is still null and an `autoFocus={!draft}`
    // prop would focus the canyon input before the offer banner ever rendered —
    // the same one-commit lag documented on `draftOfferPendingRef` above.
    //
    // Two deliberate opt-outs:
    //  - a draft is being offered: the banner asks a question, and pulling focus
    //    into the form invites typing into fields that Restore is about to
    //    overwrite.
    //  - mobile: focusing pops the on-screen keyboard over the form before the
    //    user has decided to type, hiding the fields they came to fill in.
    // The pick-on-map return leg is already excluded — that path returns early
    // above, so it never reaches this line and can't yank focus off the
    // coordinates the user just picked.
    if (!isMobile && foundDraft === null) canyonInputRef.current?.focus();
  }, [open, tripLog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The form as the draft stores it — one object feeding both the dirty-check
  // and the autosave, so the two can't disagree about what "the form" is.
  const currentForm: TripDraftForm = useMemo(
    () => ({
      date,
      notes,
      selectedCanyonIds,
      displayNameInput,
      selectedTypes,
      fieldValues,
      creating,
    }),
    [date, notes, selectedCanyonIds, displayNameInput, selectedTypes, fieldValues, creating],
  );
  const currentFingerprint = useMemo(() => tripFormFingerprint(currentForm), [currentForm]);

  // Real dirty-check: current form fields vs. the snapshot taken when the
  // dialog was (re)populated — not just "the dialog is open" (TRIP-3). Media
  // is excluded: uploads persist immediately (or via the self-cleaning draft
  // trip in create mode), so they're never "unsaved" by the time a close is
  // attempted.
  const isDirty =
    open &&
    initialFormSnapshotRef.current !== null &&
    currentFingerprint !== initialFormSnapshotRef.current;

  // Whether there's anything in the form worth keeping. Measured against the
  // pristine baseline, so a restored draft still counts as worth keeping even
  // though the guard considers it clean.
  const draftWorthKeeping =
    open &&
    !tripLog &&
    pristineFormSnapshotRef.current !== null &&
    currentFingerprint !== pristineFormSnapshotRef.current;

  const guard = useUnsavedChangesGuard(isDirty, () => void handleRequestClose());

  // Autosave the create form so a phone call, a tab eviction or a flat battery
  // doesn't take it — the exits `useUnsavedChangesGuard` structurally cannot
  // cover, because nobody is there to answer its prompt.
  useEffect(() => {
    if (!open || tripLog) return;
    // Don't overwrite the draft we're currently offering to restore.
    if (restorableDraft) return;
    const timer = setTimeout(() => {
      // Both checked at fire time, not effect time: a save that resolves while
      // this timer is pending would otherwise be followed by the timer
      // re-writing a draft for the trip that was just saved, and an offer made
      // on this same commit isn't visible in state yet.
      if (committedRef.current) return;
      if (draftOfferPendingRef.current) return;
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
        toast.error("These notes are too long to save a local draft. Save the trip so it isn't lost.");
      } else {
        console.error(result.error);
        toast.error("Couldn't save a local draft of this trip. Save it so it isn't lost.");
      }
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, tripLog, restorableDraft, draftWorthKeeping, currentForm, toast]);

  function handleRestoreDraft() {
    if (!restorableDraft) return;
    const { form } = restorableDraft;
    setDate(form.date);
    setNotes(form.notes);
    setSelectedCanyonIds(form.selectedCanyonIds);
    setDisplayNameInput(form.displayNameInput);
    setSelectedTypes(form.selectedTypes);
    setFieldValues(form.fieldValues);
    setCreating(form.creating);
    // The guard's baseline moves with the restore: the form was just populated
    // from the draft, so "dirty" means changed *since* the restore. Closing
    // straight after restoring shouldn't prompt to discard changes the user
    // just asked to keep — and the draft stays on disk regardless.
    initialFormSnapshotRef.current = tripFormFingerprint(form);
    // pristineFormSnapshotRef deliberately does NOT move — the restored form is
    // still worth autosaving, so it survives a second eviction.
    draftOfferPendingRef.current = false;
    setRestorableDraft(null);
  }

  function handleDiscardDraft() {
    clearTripDraft();
    draftOfferPendingRef.current = false;
    setRestorableDraft(null);
  }

  // In edit mode, fetch the trip's existing media (with fresh presigned URLs).
  useEffect(() => {
    if (!open || !tripLog) return;
    const { id } = tripLog;
    setMediaLoading(true);
    getTripLog(id)
      .then((full) => setMedia(full.media ?? []))
      .catch((err) => {
        console.error(err);
        setError(messageFromError(err, "Couldn't load trip files."));
      })
      .finally(() => setMediaLoading(false));
  }, [open, tripLog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the ordered canyonIds for the trip payload, creating the pending
  // inline canyon (if any) first and appending it last.
  async function resolveCanyonIds(): Promise<string[]> {
    if (!creating) return selectedCanyonIds;
    if (!creating.name.trim()) throw new Error("Canyon name is required.");
    const lat = parseFloat(creating.latitude);
    const lng = parseFloat(creating.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      throw new Error("Valid latitude and longitude are required.");
    if (!isValidLatitude(lat) || !isValidLongitude(lng))
      throw new Error(
        "Latitude must be between -90 and 90, and longitude between -180 and 180.",
      );
    const c = await createCanyon({
      name: creating.name.trim(),
      latitude: lat,
      longitude: lng,
    });
    onCanyonCreated?.();
    return [...selectedCanyonIds, c.id];
  }

  // The trip id media should link to: a real trip in edit mode, otherwise a
  // draft created on first upload. Guarded so concurrent uploads create one trip.
  function ensureLinkedTripId(): Promise<string> {
    if (tripLog) return Promise.resolve(tripLog.id);
    if (draftTripId) return Promise.resolve(draftTripId);
    if (draftPromiseRef.current) return draftPromiseRef.current;

    const customFields: Record<string, unknown> = {};
    for (const def of customFieldDefs) {
      customFields[def.key] = coerceFieldValue(getFieldValue(def.key), def.type);
    }
    // canyonIds and displayName are independent — an empty/unnamed draft is
    // valid (derives "Untitled trip" until the user fills in either).
    const promise = createTripLog({
      date,
      notes: notes || null,
      customFields,
      canyonIds: selectedCanyonIds,
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

  // Cancel/close. If a draft trip was materialised but never saved, delete it
  // (cascades its media from S3 + DB + quota) before closing.
  async function handleRequestClose() {
    if (saving) return;
    if (draftTripId && !committedRef.current) {
      try {
        await deleteTripLog(draftTripId);
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Couldn't discard uploaded files. Please try again."));
        return;
      }
    }
    onClose();
  }

  function getFieldValue(key: string): string {
    return getFieldValueFor(fieldValues, customFieldDefs, key);
  }

  function setFieldValue(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  function handlePickCoords() {
    if (!onPickCoords) return;
    pickingRef.current = true;
    onPickCoords((lat, lng) => {
      setCreating((prev) =>
        prev
          ? { ...prev, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }
          : { name: "", latitude: lat.toFixed(6), longitude: lng.toFixed(6) },
      );
    });
  }

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
    const customFieldInvalid = customFieldDefs.some(
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
      // Resolve canyon selection (may create a canyon inline)
      const canyonIds = await resolveCanyonIds();
      const displayName = displayNameInput.trim() || null;
      const types = selectedTypes;

      // Build custom fields object — only include defined fields
      const customFields: Record<string, unknown> = {};
      for (const def of customFieldDefs) {
        const raw = getFieldValue(def.key);
        customFields[def.key] = coerceFieldValue(raw, def.type);
      }

      if (tripLog) {
        await updateTripLog(tripLog.id, {
          date,
          notes: notes || null,
          customFields,
          canyonIds,
          displayName,
          types,
        });
      } else if (draftTripId) {
        // A draft was already created to hold uploaded files — persist the form.
        await updateTripLog(draftTripId, {
          date,
          notes: notes || null,
          customFields,
          canyonIds,
          displayName,
          types,
        });
      } else {
        await createTripLog({
          date,
          notes: notes || null,
          customFields,
          canyonIds,
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
      toast.success("Trip log saved.");
      onClose();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't save trip log. Please try again."));
    } finally {
      setSaving(false);
    }
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
      const updatedDefs = [...customFieldDefs, result.def];
      await updateUserPreferences({ tripLogCustomFields: updatedDefs });
      onCustomFieldDefsChange(updatedDefs);
      setShowAddField(false);
      setNewFieldLabel("");
      setNewFieldType("string");
      setNewFieldBounded(false);
      setNewFieldMin("");
      setNewFieldMax("");
    } catch (err) {
      console.error(err);
      setAddFieldError(messageFromError(err, "Couldn't save custom field. Please try again."));
    } finally {
      setAddingField(false);
    }
  }

  return (
    <>
    <Dialog
      fullScreen={isMobile}
      open={open}
      onClose={saving ? undefined : guard.requestClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
          maxHeight: isMobile ? "100%" : "85vh",
        },
      }}
    >
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}
      >
        <Typography variant="h6" component="span">
          {tripLog ? "Edit Trip Log" : "Log Trip"}
        </Typography>
        <IconButton
          aria-label="Close dialog"
          size="small"
          onClick={guard.requestClose}
          disabled={saving}
          sx={{ ...touchTargetSx, color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      {/* The form wrapper is what makes Enter submit. It has to span both the
          content and the actions, since the submit button lives in
          DialogActions. Dialog's Paper is a flex column and DialogContent
          relies on being a flex child of it to scroll (flex: 1 1 auto +
          overflow-y: auto), so the form has to carry the flex chain through
          itself or the content stops scrolling inside the dialog. */}
      <Box
        component="form"
        noValidate
        onSubmit={handleSubmit}
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: "1 1 auto",
          minHeight: 0,
        }}
      >
      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Autosaved-draft offer. An offer rather than a silent repopulate:
              the form stays fresh until the user asks for the draft back, so
              nobody has to work out why last Tuesday's text is in today's
              trip. Carries only a timestamp — no canyon names, no notes — so
              the prompt itself can't leak the payload. */}
          {restorableDraft && (
            <Box
              role="status"
              sx={{
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
                alignItems: isMobile ? "stretch" : "center",
                gap: 1,
                p: 1.5,
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--theme-accent)",
                backgroundColor: "color-mix(in srgb, var(--theme-accent) 10%, transparent)",
              }}
            >
              <Typography variant="body2" sx={{ flex: 1, color: "var(--theme-text-primary)" }}>
                You have an unsaved trip from {formatDraftSavedAt(restorableDraft.savedAt)}.
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexShrink: 0, justifyContent: "flex-end" }}>
                <Button
                  size="small"
                  onClick={handleDiscardDraft}
                  sx={{ color: "var(--theme-text-muted)" }}
                >
                  Discard
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleRestoreDraft}
                  sx={{ borderColor: "var(--theme-accent)", color: "var(--theme-accent)" }}
                >
                  Restore
                </Button>
              </Box>
            </Box>
          )}

          {/* Canyon(s) — search existing markers (ordered, chip-per-canyon) or
             create a new canyon inline. Order is meaningful: it drives the
             derived-title placeholder below. Empty selection is valid — the
             trip name field covers the no-canyon case. */}
          <Autocomplete<CanyonOption, true, false, false>
            multiple
            // Without this, typing "Claustral" and pressing Enter selects
            // nothing — there's no highlighted option to select, so the
            // keystroke falls through and the text is silently dropped.
            // Highlighting the first match makes Enter mean "take the obvious
            // one". MUI calls preventDefault() when Enter selects a highlighted
            // option, so this Enter cannot also submit the surrounding form.
            autoHighlight
            options={canyonOptions}
            getOptionLabel={getOptionLabel}
            getOptionKey={(option) =>
              // create shares its typed text as its label; a distinct key keeps
              // React from reconciling stale ghost rows across keystrokes.
              option.kind === "existing"
                ? option.canyon.id
                : `${option.kind}:${option.name}`
            }
            value={canyonValue}
            onChange={(_, vals) => {
              const ids: string[] = [];
              let nextCreating: CreateForm | null = null;
              for (const val of vals) {
                if (val.kind === "existing") ids.push(val.canyon.id);
                else {
                  nextCreating = {
                    name: val.name,
                    latitude: creating?.latitude ?? "",
                    longitude: creating?.longitude ?? "",
                  };
                }
              }
              // Cap at MAX_CANYONS_PER_TRIP (a pending create counts towards it).
              if (ids.length + (nextCreating ? 1 : 0) > MAX_CANYONS_PER_TRIP) return;
              setSelectedCanyonIds(ids);
              setCreating(nextCreating);
            }}
            filterOptions={(options, params) => {
              // Filter only real canyons; only offer "create" when there's no
              // pending create already (one inline create at a time) and the
              // cap hasn't been reached.
              const filtered = canyonFilter(options, params);
              const input = params.inputValue.trim();
              const atCap = selectedCanyonIds.length + (creating ? 1 : 0) >= MAX_CANYONS_PER_TRIP;
              if (input && !creating && !atCap) {
                filtered.push({ kind: "create", name: input });
              }
              return filtered;
            }}
            isOptionEqualToValue={(opt, val) => {
              if (opt.kind !== val.kind) return false;
              if (opt.kind === "existing" && val.kind === "existing")
                return opt.canyon.id === val.canyon.id;
              return getOptionLabel(opt) === getOptionLabel(val);
            }}
            renderOption={(props, option) => {
              const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
              return (
                <li key={key} {...rest}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {getOptionLabel(option)}
                    </span>
                    {option.kind === "create" && (
                      <Chip label="Create new canyon" size="small" color="primary" sx={{ fontSize: "0.7em", height: 20 }} />
                    )}
                  </Box>
                </li>
              );
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                return (
                  <Chip
                    key={key}
                    label={getOptionLabel(option)}
                    size="small"
                    color={option.kind === "create" ? "primary" : "default"}
                    {...tagProps}
                  />
                );
              })
            }
            size="small"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Canyons"
                placeholder={
                  selectedCanyonIds.length + (creating ? 1 : 0) >= MAX_CANYONS_PER_TRIP
                    ? undefined
                    : "Search canyons, or type to create one"
                }
                // Focused imperatively by the form-reset effect above, which is
                // the only place that knows whether a draft is being offered.
                inputRef={canyonInputRef}
                size="small"
                sx={fieldSx}
              />
            )}
            PaperComponent={({ children }) => (
              <Box sx={{ backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)", border: "1px solid rgba(255,255,255,0.1)" }}>
                {children}
              </Box>
            )}
            sx={{ "& .MuiInputBase-input": { color: "var(--theme-text-primary)" } }}
          />

          {/* Inline canyon creation — lat/long + pick on map. Name comes from
              the canyon field text; no separate name input. */}
          {creating && (
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <TextField
                label="Latitude"
                value={creating.latitude}
                onChange={(e) =>
                  setCreating((prev) => (prev ? { ...prev, latitude: e.target.value } : prev))
                }
                size="small"
                sx={{ ...fieldSx, flex: 1 }}
                placeholder="-33.123456"
              />
              <TextField
                label="Longitude"
                value={creating.longitude}
                onChange={(e) =>
                  setCreating((prev) => (prev ? { ...prev, longitude: e.target.value } : prev))
                }
                size="small"
                sx={{ ...fieldSx, flex: 1 }}
                placeholder="150.123456"
              />
              {onPickCoords && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handlePickCoords}
                  sx={{
                    borderColor: "var(--theme-accent)",
                    color: "var(--theme-accent)",
                    flexShrink: 0,
                    fontSize: "0.75em",
                  }}
                >
                  Pick on map
                </Button>
              )}
            </Box>
          )}

          {/* Trip name — overrides the derived title (joined canyon names).
              Placeholder previews what the title would be if left blank. */}
          <TextField
            label="Trip name"
            value={displayNameInput}
            onChange={(e) => setDisplayNameInput(e.target.value)}
            placeholder={formatTripCanyonNames(selectedCanyonNames) ?? "Untitled trip"}
            size="small"
            fullWidth
            sx={fieldSx}
          />

          {/* Types — free text, multiple, seeded with built-in suggestions plus
              whatever the user has already typed across their trip history.
              Mirrors the Canyons picker: chips in the field, an `Add "<input>"`
              row for unseen text, case-insensitive dedupe, capped. */}
          <Autocomplete<TypeOption, true, false, true>
            multiple
            freeSolo
            // Highlights the first suggestion so Enter takes it. freeSolo keeps
            // typed text winning over a merely-programmatic highlight (MUI only
            // selects the highlighted option here once the user has deliberately
            // arrowed or hovered onto it), so this can't hijack a genuinely new
            // type. Either branch calls preventDefault(), so Enter adds the type
            // without also submitting the form.
            autoHighlight
            options={typeOptions}
            getOptionLabel={getTypeOptionLabel}
            getOptionKey={(option) =>
              typeof option === "string"
                ? option
                : `${option.kind}:${option.label.toLowerCase()}`
            }
            value={typeValue}
            onChange={(_, vals) => {
              // freeSolo delivers plain strings for Enter-on-free-text; option
              // objects otherwise. Normalize, trim, and dedupe
              // case-insensitively (adding "Canyoning" over "canyoning" is a
              // no-op that keeps the first casing).
              const next: string[] = [];
              const seen = new Set<string>();
              for (const val of vals) {
                const label = getTypeOptionLabel(val).trim();
                if (!label) continue;
                const key = label.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                next.push(label);
              }
              // Cap at MAX_TRIP_TYPES_PER_TRIP (mirrors the canyon cap).
              if (next.length > MAX_TRIP_TYPES_PER_TRIP) return;
              // Re-enforce: the locked chip has no delete button, but Backspace
              // in the input still pops the last tag, so the tag has to be put
              // back here too. enforceCanyoningTag skips at the cap, so this
              // can never push `next` past the check above.
              setSelectedTypes(enforceCanyoningTag(next, hasLinkedCanyon));
            }}
            filterOptions={(options, params) => {
              const filtered = typeFilter(options, params);
              const input = params.inputValue.trim();
              const atCap = selectedTypes.length >= MAX_TRIP_TYPES_PER_TRIP;
              // Only offer "Add" when the text matches no known or selected
              // type case-insensitively and the cap hasn't been reached.
              const matchesKnown =
                knownTypes.some((t) => t.toLowerCase() === input.toLowerCase()) ||
                selectedTypes.some((t) => t.toLowerCase() === input.toLowerCase());
              if (input && !matchesKnown && !atCap) {
                filtered.push({ kind: "new", label: input });
              }
              return filtered;
            }}
            isOptionEqualToValue={(opt, val) =>
              getTypeOptionLabel(opt).toLowerCase() ===
              getTypeOptionLabel(val).toLowerCase()
            }
            renderOption={(props, option) => {
              const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
              return (
                <li key={key} {...rest}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {typeof option !== "string" && option.kind === "new"
                        ? `Add "${option.label}"`
                        : getTypeOptionLabel(option)}
                    </span>
                    {typeof option !== "string" && option.kind === "new" && (
                      <Chip label="New type" size="small" color="primary" sx={{ fontSize: "0.7em", height: 20 }} />
                    )}
                  </Box>
                </li>
              );
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                const label = getTypeOptionLabel(option);
                // The canyoning tag is locked (visible, not removable) while a
                // canyon is linked — the API re-adds it on save, so offering a
                // delete that silently undoes itself would be a lie. Unlink the
                // canyons and it becomes an ordinary, removable tag.
                const locked =
                  hasLinkedCanyon && label.toLowerCase() === CANYONING_TRIP_TYPE;
                return (
                  <Chip
                    key={key}
                    label={label}
                    size="small"
                    sx={typeChipSx}
                    {...tagProps}
                    {...(locked && {
                      onDelete: undefined,
                      title: "Trips with a linked canyon are always tagged canyoning.",
                    })}
                  />
                );
              })
            }
            size="small"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Types"
                placeholder={
                  selectedTypes.length >= MAX_TRIP_TYPES_PER_TRIP
                    ? undefined
                    : "e.g. canyoning, bushwalking"
                }
                size="small"
                sx={fieldSx}
              />
            )}
            PaperComponent={({ children }) => (
              <Box sx={{ backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)", border: "1px solid rgba(255,255,255,0.1)" }}>
                {children}
              </Box>
            )}
            sx={{ "& .MuiInputBase-input": { color: "var(--theme-text-primary)" } }}
          />

          {/* Date */}
          <Box>
            <TextField
              label="Date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              size="small"
              fullWidth
              required
              error={!date && error === "Date is required."}
              InputLabelProps={{ shrink: true }}
              sx={fieldSx}
            />
            {/* Non-blocking hint — a future date is allowed (trip planning), we
                just flag it so an accidental typo doesn't pass unnoticed. */}
            {isFutureDate(date) && (
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  mt: 0.5,
                  color: "var(--theme-text-muted)",
                }}
              >
                This date is in the future.
              </Typography>
            )}
          </Box>

          {/* Notes */}
          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            // Auto-grow: rests at the same 4 rows it always has, then follows
            // the text instead of scrolling inside itself. Capped at
            // NOTES_MAX_ROWS so it can't swallow the dialog.
            minRows={4}
            maxRows={NOTES_MAX_ROWS}
            size="small"
            fullWidth
            placeholder="Trip notes, conditions, observations..."
            sx={fieldSx}
          />

          {/* Custom fields */}
          {customFieldDefs.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Custom Fields
              </Typography>
              {customFieldDefs.map((def) => (
                <Box
                  key={def.key}
                  sx={{ display: "flex", gap: 1, alignItems: "center" }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <CustomFieldInput
                      def={def}
                      value={getFieldValue(def.key)}
                      onChange={(v) => setFieldValue(def.key, v)}
                      showError={showFieldErrors}
                    />
                  </Box>
                  <IconButton
                    aria-label={`Delete custom field ${def.label}`}
                    size="small"
                    onClick={() => setFieldToDelete(def)}
                    sx={{
                      ...touchTargetSx,
                      color: "var(--theme-text-muted)",
                      flexShrink: 0,
                      "&:hover": { color: "var(--theme-warning)" },
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}

          {/* Add custom field */}
          {showAddField ? (
            <AddCustomFieldForm
              entityNoun="trip logs"
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
              size="small"
              onClick={() => setShowAddField(true)}
              sx={{
                ...touchTargetSx,
                color: "var(--theme-accent)",
                textTransform: "none",
                alignSelf: "flex-start",
                px: 0,
              }}
            >
              + Add Custom Field
            </Button>
          )}

          {/* Media. In create mode the first upload lazily creates a draft trip
              to link files to; cancelling deletes it (and its files). Split into
              photos/videos and tracks, both allowing multiple files. */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Photos &amp; Videos
            </Typography>
            <div className={classes.mediaScroll}>
              {mediaLoading ? (
                <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", fontStyle: "italic" }}>
                  Loading files…
                </Typography>
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
            </div>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Tracks (GPX/KML)
            </Typography>
            <div className={classes.mediaScroll}>
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
            </div>
          </Box>

          {error && <ErrorBanner message={error} />}
        </Box>
      </DialogContent>

      <DialogActions>
        {/* Not "Cancel": the add-custom-field sub-form below renders its own
            "Cancel" that only backs out of that sub-form, and on mobile both
            are on screen at once — two identical words, opposite scopes. Naming
            the object makes the scope unambiguous. In edit mode the object is
            the *changes*, not the trip: "Discard trip" on a saved trip would
            read as "delete it from my logbook". */}
        <Button
          onClick={guard.requestClose}
          disabled={saving}
          sx={{ ...dialogActionButtonSx, color: "var(--theme-text-primary)" }}
        >
          {tripLog ? "Discard changes" : "Discard trip"}
        </Button>
        {/* type="submit" with no onClick — handleSubmit is the only save path,
            so a click can't fire alongside the form's submit. */}
        <Button
          type="submit"
          variant="contained"
          color="secondary"
          disabled={saving || !date}
          sx={dialogActionButtonSx}
        >
          {saving ? <CircularProgress size={20} /> : tripLog ? "Save Changes" : "Log Trip"}
        </Button>
      </DialogActions>
      </Box>
    </Dialog>

    {/* Impact-aware delete confirm (shared with the Account panel). On delete
        the server strips the field's values from all trips; mirror that
        locally by dropping the form value. */}
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
