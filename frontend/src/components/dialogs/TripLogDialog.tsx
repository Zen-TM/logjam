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
import { fieldSx, typeChipSx } from "../../csvImport/dialogStyles";
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

type CreateForm = { name: string; latitude: string; longitude: string };

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
  // apart from "the dialog is open" (TRIP-3).
  const initialFormSnapshotRef = useRef<string | null>(null);

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
    initialFormSnapshotRef.current = JSON.stringify({
      date: initialDate,
      notes: initialNotes,
      selectedCanyonIds: initialSelectedCanyonIds,
      displayNameInput: initialDisplayNameInput,
      selectedTypes: initialSelectedTypes,
      fieldValues: initialFieldValues,
      creating: null as CreateForm | null,
    });
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
  }, [open, tripLog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real dirty-check: current form fields vs. the snapshot taken when the
  // dialog was (re)populated — not just "the dialog is open" (TRIP-3). Media
  // is excluded: uploads persist immediately (or via the self-cleaning draft
  // trip in create mode), so they're never "unsaved" by the time a close is
  // attempted.
  const isDirty =
    open &&
    initialFormSnapshotRef.current !== null &&
    JSON.stringify({
      date,
      notes,
      selectedCanyonIds,
      displayNameInput,
      selectedTypes,
      fieldValues,
      creating,
    }) !== initialFormSnapshotRef.current;

  const guard = useUnsavedChangesGuard(isDirty, () => void handleRequestClose());

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
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Canyon(s) — search existing markers (ordered, chip-per-canyon) or
             create a new canyon inline. Order is meaningful: it drives the
             derived-title placeholder below. Empty selection is valid — the
             trip name field covers the no-canyon case. */}
          <Autocomplete<CanyonOption, true, false, false>
            multiple
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
            rows={4}
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
        <Button
          onClick={guard.requestClose}
          disabled={saving}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={handleSave}
          disabled={saving || !date}
        >
          {saving ? <CircularProgress size={20} /> : tripLog ? "Save Changes" : "Log Trip"}
        </Button>
      </DialogActions>
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
      onConfirm={guard.confirmDiscard}
      onClose={guard.cancelDiscard}
    />
    </>
  );
}

export default TripLogDialog;
