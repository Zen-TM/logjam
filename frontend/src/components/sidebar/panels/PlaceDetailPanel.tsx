// One place: what it is, what this kind of place records, and what can be done
// with it.
//
// Every attribute is read from its definition: definitions are the list,
// and `SYSTEM_FIELD_DEFS` is where a built-in's unit lives, so built-in
// and custom attributes render through the same definition loop.
//
// Which verbs it offers is `placeVerbs` (placesModel.ts), not this file's
// judgement — the same rule `wayActions.ts` holds for ways, so a place's row
// and its page cannot drift into disagreeing about what can be done with it.
import {
  useState,
  useEffect,
  useMemo,
  useRef,
  Fragment,
  type ReactNode,
} from "react";
import {
  asForeignFields,
  copyAndRemoveConfirm,
  defsForType,
  fieldValue,
  formatDateKey,
  formatFieldValue,
  isReservedFieldKey,
  formatDistanceM,
  mediaCategory,
  mediaDisplayName,
  placeRoute,
  routeLengthM,
  primaryTripType,
  placeDeleteConfirm,
  placeLinkedToast,
  placeDeleteDone,
  removeShareConfirm,
  contractSectionsFor,
  canyonGradeRow,
  isCanyonGradeKey,
  ADD_WAY,
  PLACE_PAGE,
  PLACE_PAGE_PRIMARY_VERBS,
  WEATHER,
  formatPlacePosition,
  placeAttributesTitle,
  placeSectionTitle,
  placeSources,
  placeStatus,
  placeStatusLabel,
  placeVerbs,
  withFieldUnit,
  type SectionKeysOn,
  type MediaItem,
  type ScopedCustomFieldDef,
  type TripLogCustomFieldDef,
} from "@logjam/shared";
import classes from "./PlaceDetailPanel.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import { PlaceGauge } from "../../gauges/PlaceGauge";
import { PlaceWeather } from "../../weather/PlaceWeather";
import PlaceDialog from "../../dialogs/PlaceDialog";
import ShareDialog from "../../dialogs/ShareDialog";
import { NoteBody } from "../../plans/WriteUpBody";
import TripLogDialog from "../../dialogs/TripLogDialog";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import AddWayDialog from "../../dialogs/AddWayDialog";
import type {
  TPlace,
  TFriend,
  TTripLog,
  TPlaceShare,
  TPlaceType,
  TRoute,
} from "../../../placeUtils";
import { boundsOfPoints } from "./waysModel";
import {
  deletePlace,
  getCustomFields,
  resolveForeignField,
  deleteMedia,
  copyPlace,
  sharePlaceWith,
  unsharePlaceWith,
  getTripLogs,
  getPlaceDetail,
  getPlaceShares,
  ownerUsername,
  updatePlace,
} from "../../../placeUtils";
import PlaceSlideshow from "../../media/PlaceSlideshow";
import MediaUpload from "../../media/MediaUpload";
import PlacePicker from "../../common/PlacePicker";
import { placeTypeLucideIcon } from "./placeTypeIcon";
import { tripTypeLook } from "./tripTypeIcon";
import { placeVerbEntries, type WebPlaceVerbId } from "./placeVerbMenu";
import {
  Button,
  Dialog,
  EmptyState,
  Hero,
  Icon,
  IconButton,
  IconTile,
  Menu,
  Row,
  SectionHeader,
  StatGrid,
  StatusPill,
} from "../../../ui";
import {
  formatCanyonGrade,
  linkMediaToPlace,
  updateRoute,
} from "../../../placeUtils";

/**
 * Runs a verb pressed on the place's ROW that needs this page's forms and
 * confirms. Once per request: the ref outlives StrictMode's second effect
 * pass, which would otherwise save two copies of a shared place.
 */
function RunVerbRequest({
  request,
  run,
  onConsumed,
}: {
  request: { id: WebPlaceVerbId } | null;
  run: (id: WebPlaceVerbId) => void;
  onConsumed: () => void;
}) {
  const handled = useRef<object | null>(null);
  useEffect(() => {
    if (!request || handled.current === request) return;
    handled.current = request;
    run(request.id);
    onConsumed();
  });
  return null;
}

// Format a stored attribute value for display. Returns null when the value is
// empty so the caller can skip the row entirely.
function formatCustomFieldValue(
  value: unknown,
  type: TripLogCustomFieldDef["type"],
): string | null {
  if (value == null || value === "") return null;
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "date" && typeof value === "string") {
    // Date-typed attributes are stored as UTC-midnight (date-only); format in
    // UTC so AEST (UTC+10/+11) doesn't render the prior day.
    return new Date(value).toLocaleDateString("en-AU", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return String(value);
}

/** The value as it is READ: the stored answer plus its unit ("15 m"). */
function displayValue(def: TripLogCustomFieldDef, raw: unknown): string | null {
  const text = formatCustomFieldValue(raw, def.type);
  return text == null ? null : withFieldUnit(def.key, text);
}

/** A parked value as one line. Objects are stringified rather than dropped:
 *  the point of the section is that the user can SEE what arrived before
 *  deciding what to do with it. */
function foreignValueText(item: { value: unknown; type: string }): string {
  if (item.value !== null && typeof item.value === "object")
    return JSON.stringify(item.value);
  return formatFieldValue(item.value, item.type);
}

// Grammatical list: "a", "a and b", "a, b, and c".
function joinWithAnd(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function PlaceDetailPanel({
  place,
  places,
  isOwnedPlace,
  friends,
  onRefetch,
  onRefetchShared,
  setSelectedPlaceID,
  onPickCoords,
  pickingCoords,
  onCancelPickCoords,
  onBack,
  onOpenTrip,
  onMakeMap,
  onExportPlace,
  verbRequest,
  onVerbRequestConsumed,
  customFieldDefs,
  placeTypes,
  onCustomFieldDefsChange,
  placeCustomFieldDefs,
  onPlaceCustomFieldDefsChange,
  onQuotaChanged,
  onWaysChanged,
  onRefetchTripLogs,
  onAfterDelete,
  routes,
  currentUserId,
  onFocusBounds,
  onOpenRoute,
  onRoutesChanged,
  onDrawRoute,
}: {
  place: TPlace | undefined;
  places: TPlace[];
  isOwnedPlace: boolean;
  friends: TFriend[];
  onRefetch: () => void;
  onRefetchShared: () => void;
  setSelectedPlaceID: (id: string | null) => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  pickingCoords: boolean;
  onCancelPickCoords: () => void;
  /** Back to the list this place was opened from. */
  onBack: () => void;
  /** Centre the map on this place — the same verb its row and its pin offer. */
  /** A trip is READ on its own page (DESIGN.md), not in a dialog over this one. */
  onOpenTrip: (tripLogId: string) => void;
  /** Start a map over this place; the menu names the two kinds. */
  onMakeMap: (place: TPlace, kind: "topo" | "geopdf") => void;
  /** Open the share-or-export dialog on this place, the one the list uses. */
  onExportPlace: (placeId: string) => void;
  /** A verb pressed on this place's row in the list, for this page to run. */
  verbRequest: { id: WebPlaceVerbId } | null;
  onVerbRequestConsumed: () => void;
  customFieldDefs: ScopedCustomFieldDef[];
  /** The types a place may be filed under, passed to the edit dialog. */
  placeTypes: TPlaceType[];
  onCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  placeCustomFieldDefs: ScopedCustomFieldDef[];
  onPlaceCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  onQuotaChanged: () => void;
  /** A file was attached or removed: the Ways list reads files from here too. */
  onWaysChanged: () => void;
  // Retrigger the global Trip Logs list/search after a trip is created or
  // deleted here — the place-scoped refetch below only updates this panel.
  onRefetchTripLogs: () => void;
  // Leave the (now-empty) place-detail panel after a delete so it doesn't
  // dead-end in "No place selected".
  onAfterDelete: () => void;
  /** Every drawn route the user can see; one may fill this place's route slot. */
  routes: TRoute[];
  /** Whose routes are the user's own: only those can be attached here. */
  currentUserId: string | null;
  /** Fit the map to a box, as the route row's tap does. */
  onFocusBounds: (bounds: [number, number, number, number]) => void;
  /** Open the route's own page (the Way). */
  onOpenRoute: (route: TRoute) => void;
  /** A route was changed here (unlinked); the Ways list must refetch. */
  onRoutesChanged: () => void;
  /** Arm the map's pen for this place's route slot. */
  onDrawRoute: (placeId: string) => void;
}) {
  const toast = useToast();
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // `copyAndRemoveConfirm` uses the same confirmation wording as Logjam GPS.
  const [confirmCopyAndRemove, setConfirmCopyAndRemove] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [addingWay, setAddingWay] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<MediaItem | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);

  const [tripLogs, setTripLogs] = useState<TTripLog[]>([]);
  const [placeMedia, setPlaceMedia] = useState<MediaItem[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [showTripLogDialog, setShowTripLogDialog] = useState(false);
  const [editingTripLog, setEditingTripLog] = useState<TTripLog | undefined>(
    undefined,
  );

  const [copying, setCopying] = useState(false);
  const [placeShares, setPlaceShares] = useState<TPlaceShare[]>([]);
  /** The parked value whose dialog is open, whether its action is running,
   *  and whether its Discard is being confirmed. */
  const [foreignKey, setForeignKey] = useState<string | null>(null);
  const [foreignFieldBusy, setForeignFieldBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // The other end of every link touching this place. The list arrives on the
  // OWNED place rows (`linkedPlaceIds`, owner-private), so the names come from
  // the places already loaded rather than another fetch.
  const linkedPlaces = useMemo(() => {
    const ids = new Set(place?.linkedPlaceIds ?? []);
    return places
      .filter((row) => ids.has(row.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [place?.linkedPlaceIds, places]);

  const foreignFields = useMemo(
    () => asForeignFields(place?.foreignFields),
    [place?.foreignFields],
  );
  const foreignItem =
    foreignFields.find((item) => item.key === foreignKey) ?? null;
  const placeType = placeTypes.find((type) => type.id === place?.placeTypeId);
  const TypeGlyph = placeTypeLucideIcon(placeType?.iconKey ?? "map-pin");

  /** What this KIND of place records, and what this one answered. Only the
   *  answered ones: a form asks every question, a page reports the answers.
   *  The three grade inputs read as the one Grade row, first, as on the hero. */
  const attributes = useMemo(() => {
    if (!place) return [];
    const answered = defsForType(placeCustomFieldDefs, place.placeTypeId)
      .filter((def) => !isCanyonGradeKey(def.key))
      .map((def) => ({
        key: def.key,
        label: def.label,
        text: displayValue(def, fieldValue(place.fieldValues, def.key)),
      }))
      .filter(
        (row): row is { key: string; label: string; text: string } =>
          row.text != null,
      );
    const grade = canyonGradeRow(place.fieldValues);
    return grade
      ? [
          { key: grade[0], label: grade[1], text: String(grade[2]) },
          ...answered,
        ]
      : answered;
  }, [place, placeCustomFieldDefs]);

  /**
   * Adopt / discard / append one parked value.
   *
   * ONLINE-ONLY, like sharing: `foreignFields` is not client-writable by
   * design (it is absent from the push allowlist), so there is no offline
   * queue for this and the failure is reported rather than swallowed.
   */
  async function runForeignFieldAction(action: "adopt" | "discard" | "notes") {
    if (!place || !foreignItem) return;
    setForeignFieldBusy(true);
    try {
      await resolveForeignField(place.id, foreignItem.key, action);
      // Adopting creates a definition, so the field list has to move with it —
      // otherwise the value lands in a field the form does not yet know about
      // and reads as having vanished.
      if (action === "adopt") {
        onPlaceCustomFieldDefsChange(await getCustomFields("place"));
      }
      setConfirmDiscard(false);
      setForeignKey(null);
      onRefetch();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't update that attribute."));
    } finally {
      setForeignFieldBusy(false);
    }
  }

  // Type suggestions for the trip dialog, flattened from this place's own
  // trips (the only trip list this panel loads).
  const existingTripTypes = useMemo(
    () => tripLogs.flatMap((t) => t.types),
    [tripLogs],
  );

  // Both fetch effects below guard on a request key held in a ref: StrictMode
  // (dev) runs each effect twice with identical deps, which would fire
  // GET /places/:id and GET /places/:id/shares twice per place selection.
  // The refs survive the double-invoke, so the second identical run skips.
  // Each key includes every dep that should trigger a refetch.
  const sharesFetchKeyRef = useRef<string | null>(null);
  const detailFetchKeyRef = useRef<string | null>(null);

  // Owner-only "shared with" list. Refetches when the share dialog closes so a
  // just-made share/unshare reflects immediately.
  // Not an owned place, no "shared with" line: emptied during render. (A late
  // response can't refill it: the fetch below drops one whose key moved on.)
  if ((!place || !isOwnedPlace) && placeShares.length > 0) setPlaceShares([]);
  useEffect(() => {
    if (!place || !isOwnedPlace) {
      sharesFetchKeyRef.current = null;
      return;
    }
    const fetchKey = `${place.id}:${showShareDialog}`;
    if (sharesFetchKeyRef.current === fetchKey) return;
    sharesFetchKeyRef.current = fetchKey;
    getPlaceShares(place.id)
      .then((shares) => {
        // Stale-response guard: a slower response for a place/dialog-state
        // the user has since navigated away from must not overwrite what's
        // now showing. The ref already moved on if this fetch is no longer current.
        if (sharesFetchKeyRef.current !== fetchKey) return;
        setPlaceShares(shares);
      })
      // Best-effort: this line is informational; on failure just omit it.
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.id, isOwnedPlace, showShareDialog]);

  // Another place shows its trips loading, and no place empties them, during
  // render; the effect below fetches.
  const placeId = place?.id ?? null;
  const [detailFor, setDetailFor] = useState<string | null>(null);
  if (placeId !== detailFor) {
    setDetailFor(placeId);
    if (placeId === null) {
      setTripLogs([]);
      setPlaceMedia([]);
    } else {
      setLoadingTrips(true);
    }
  }
  useEffect(() => {
    if (!place) {
      detailFetchKeyRef.current = null;
      return;
    }
    if (detailFetchKeyRef.current === place.id) return;
    detailFetchKeyRef.current = place.id;
    const requestedId = place.id;
    // One fetch yields place-level media plus (for owners) the trip logs.
    getPlaceDetail(requestedId)
      .then((detail) => {
        // Stale-response guard: a slower place-A response landing after a
        // since-selected place-B's must not overwrite B's panel. The dedup
        // ref has already moved to B by the time this resolves if that happened.
        if (detailFetchKeyRef.current !== requestedId) return;
        setTripLogs(detail.tripLogs ?? []);
        setPlaceMedia(detail.media);
      })
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load place details."));
      })
      .finally(() => {
        if (detailFetchKeyRef.current === requestedId) setLoadingTrips(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.id, toast]);

  if (!place) {
    return (
      <div className={classes.root}>
        <Hero title="Place" onBack={onBack} backLabel="Back to Places" />
        <div className={classes.body}>
          <EmptyState
            icon="map"
            title="No place selected"
            body="Pick one from Places, or press a pin on the map."
          />
        </div>
      </div>
    );
  }

  // The place is definitely there from here down; keep a narrowed binding so
  // the callbacks below don't each have to re-check it.
  const current = place;

  const coordinates = formatPlacePosition(current.latitude, current.longitude);

  /** The one thing a coordinate is FOR: getting it into whatever the user is
   *  navigating with, so the coordinates are the control. */
  async function handleCopyCoordinates() {
    try {
      await navigator.clipboard.writeText(coordinates);
      toast.done(PLACE_PAGE.copy.copyPosition);
    } catch (err) {
      // A browser that refuses the clipboard (no permission, no secure
      // context) must say so rather than looking like it worked.
      console.error(err);
      toast.error("Couldn't copy the coordinates.");
    }
  }

  // NO `mediaLeftBehind`: whether photos come is the account's remembered
  // preference and this app has no switch for it, so the confirm promises
  // nothing about them and `handleCopyPlace` reports what actually happened.
  const copyAndRemoveCopy = copyAndRemoveConfirm({
    kindLabel: "place",
    itemName: current.name,
    ownerName: ownerUsername(friends, current.ownerId),
  });
  const deleteCopy = placeDeleteConfirm(
    { name: current.name },
    loadingTrips ? undefined : tripLogs.length,
  );
  const removeCopy = removeShareConfirm({
    kindLabel: "place",
    itemName: current.name,
    ownerName: ownerUsername(friends, current.ownerId),
  });

  // Owner-only "shared with" line: list up to 3 names, else 2 + "N more" link.
  const sharedNames = placeShares.map((s) => s.sharedWith.username);
  const sharedWithNode =
    isOwnedPlace && sharedNames.length > 0 ? (
      sharedNames.length <= 3 ? (
        joinWithAnd(sharedNames)
      ) : (
        <>
          {sharedNames[0]}, {sharedNames[1]}, and{" "}
          <button
            type="button"
            className={classes.sharedMoreLink}
            onClick={() => setShowShareDialog(true)}
          >
            {sharedNames.length - 2} more
          </button>
        </>
      )
    ) : null;

  async function handleDelete() {
    setDeleting(true);
    try {
      await deletePlace(current.id);
      setShowDeleteConfirm(false);
      setDeleting(false);
      setSelectedPlaceID(null);
      onRefetch();
      onQuotaChanged();
      toast.done(placeDeleteDone(1));
      // Return to the places list — the detail panel has nothing to show now.
      onAfterDelete();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't delete place. Try again."));
      setDeleting(false);
    }
  }

  async function handleRemoveShare() {
    setRemoving(true);
    try {
      await unsharePlaceWith(current.id, "me");
      setConfirmRemove(false);
      onRefetchShared();
      setSelectedPlaceID(null);
      onAfterDelete();
      toast.done("Removed.");
    } catch (err) {
      console.error(err);
      toast.error(
        messageFromError(err, "Couldn't remove that place. Try again."),
      );
    } finally {
      setRemoving(false);
    }
  }

  /**
   * Copy, and optionally drop the share once the copy has landed.
   *
   * THE ORDER IS THE DESIGN, and it is the same one Logjam GPS follows: a copy
   * that fails takes its remove with it, so nothing is given up that was not
   * saved first. Never the other way round, and never "remove anyway".
   *
   * The media report comes back on the response rather than being predicted in
   * the confirm. Whether photos come is the account's remembered
   * `copyPlaceMedia`, which this app has no switch for yet, so the honest thing
   * is to promise nothing beforehand and say what happened after.
   */
  async function handleCopyPlace(andRemove: boolean) {
    setCopying(true);
    try {
      const copied = await copyPlace(current.id);
      const skipped = copied.mediaSkipped ?? 0;
      if (andRemove) {
        await unsharePlaceWith(current.id, "me");
        onRefetchShared();
        setSelectedPlaceID(null);
      }
      if (skipped > 0) {
        toast.error(
          copied.mediaOutOfSpace
            ? `Copied, but your storage is full — ${skipped === 1 ? "1 photo or file" : `${skipped} photos and files`} weren't copied.`
            : `Copied, but ${skipped === 1 ? "1 photo or file" : `${skipped} photos and files`} couldn't be copied.`,
        );
      } else {
        toast.done(
          andRemove ? "Copied, and the shared one removed." : "Copied.",
        );
      }
      onRefetch();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't copy place. Try again."));
    } finally {
      setCopying(false);
      setConfirmCopyAndRemove(false);
    }
  }

  // Re-pull place-level media after the edit dialog uploads/deletes, so the
  // slideshow + track row reflect changes without waiting for a Save.
  function reloadPlaceMedia() {
    const requestedId = current.id;
    getPlaceDetail(requestedId)
      .then((detail) => {
        // Stale-response guard: don't apply a response for a place the user has since left.
        if (detailFetchKeyRef.current !== requestedId) return;
        setPlaceMedia(detail.media);
      })
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't refresh media."));
      });
    onQuotaChanged();
    onWaysChanged();
  }

  function refreshTripLogs() {
    getTripLogs(current.id)
      .then(setTripLogs)
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't refresh trips."));
      });
    // Also refresh the global Trip Logs list/search (separate query).
    onRefetchTripLogs();
  }

  async function handleDeleteFile() {
    if (!fileToDelete) return;
    setDeletingFile(true);
    try {
      await deleteMedia(fileToDelete.id);
      setPlaceMedia((prev) => prev.filter((m) => m.id !== fileToDelete.id));
      setFileToDelete(null);
      onQuotaChanged();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't delete file. Try again."));
    } finally {
      setDeletingFile(false);
    }
  }

  const busy = copying || deleting || removing;

  // The API takes the WHOLE list of links on a place PATCH.
  async function writeLinks(ids: string[], done: string, failed: string) {
    try {
      await updatePlace(current.id, { linkedPlaceIds: ids });
      toast.done(done);
      onRefetch();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, failed));
    }
  }

  async function setGauge(gaugeId: string | null) {
    try {
      await updatePlace(current.id, { gaugeId });
      onRefetch();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, PLACE_PAGE.copy.gaugeSaveFailed));
    }
  }

  // Exhaustive by type: every verb the contract gives Logjam Web has a runner.
  const verbRunners: Record<WebPlaceVerbId, () => void> = {
    open: () => {}, // A row's verb; this page is what it opens.
    edit: () => setShowEdit(true),
    logTrip: () => {
      setEditingTripLog(undefined);
      setShowTripLogDialog(true);
    },
    makeTopo: () => onMakeMap(current, "topo"),
    exportArea: () => onMakeMap(current, "geopdf"),
    exportPlace: () => onExportPlace(current.id),
    share: () => setShowShareDialog(true),
    copy: () => void handleCopyPlace(false),
    copyAndRemove: () => setConfirmCopyAndRemove(true),
    remove: () => setConfirmRemove(true),
    delete: () => setShowDeleteConfirm(true),
  };

  const entries = placeVerbEntries(
    "page",
    isOwnedPlace,
    (id) => verbRunners[id](),
    busy,
  );

  const visualMedia = placeMedia.filter(
    (m) => mediaCategory(m.mediaType) !== "track",
  );
  const slot = place ? placeRoute(place.id, routes, placeMedia) : null;
  const track = slot?.kind === "file" ? slot.file : null;
  const drawnRoute = slot?.kind === "drawn" ? slot.route : null;

  const copy = PLACE_PAGE.copy;
  const sources = placeSources(current.fieldValues);
  const placeStatusKey = isOwnedPlace
    ? loadingTrips
      ? null
      : placeStatus({ syncRole: "owner" }, tripLogs.length)
    : placeStatus({ syncRole: "shared" }, 0);
  const grade = formatCanyonGrade(current.fieldValues);
  const isShared = placeShares.length > 0;
  const primaryVerbs = placeVerbs("web", "page", isOwnedPlace).filter((verb) =>
    (PLACE_PAGE_PRIMARY_VERBS as readonly string[]).includes(verb.id),
  );

  // Exhaustive by type: a section the contract names and this page does not
  // draw, or the reverse, fails `tsc` (`PLACE_PAGE`, shared/src/contracts).
  const sections: Record<
    SectionKeysOn<typeof PLACE_PAGE, "web">,
    () => ReactNode
  > = {
    hero: () => (
      <div className={classes.section}>
        {/* WHAT IT IS, in the type's own tile (its hue is a fill, never a
            glyph on the page: shared/DESIGN.md §7), then where it stands: a
            fact, not a field, so a line and pills rather than a row in a
            table. */}
        <p className={classes.identity}>
          <IconTile
            icon={TypeGlyph}
            hue={placeType?.color ?? "var(--color-accent)"}
          />
          {placeType?.name ?? "Unknown type"}
        </p>
        <div className={classes.pills}>
          {grade ? <StatusPill label={grade} tone="outline" /> : null}
          {placeStatusKey ? (
            <StatusPill
              label={placeStatusLabel(
                placeStatusKey,
                tripLogs.length,
                ownerUsername(friends, current.ownerId),
              )}
              tone={placeStatusKey === "done" ? "accent" : "outline"}
            />
          ) : null}
        </div>
        {current.altNames.length > 0 && (
          <p className={classes.meta}>
            {copy.alsoKnownAs} {current.altNames.join(", ")}
          </p>
        )}
      </div>
    ),

    verbs: () =>
      primaryVerbs.length > 0 ? (
        <div className={classes.verbs}>
          {primaryVerbs.map((verb, index) => (
            <Button
              key={verb.id}
              variant={index === primaryVerbs.length - 1 ? "filled" : "outline"}
              icon={verb.icon}
              disabled={busy}
              disabledReason="Working…"
              onClick={() => verbRunners[verb.id]()}
            >
              {verb.label}
            </Button>
          ))}
        </div>
      ) : null,

    // WHERE IT IS, as the thing people actually do with it: copy the
    // coordinates into whatever they are navigating with.
    position: () => (
      <section className={classes.section}>
        <SectionHeader title={copy.position} />
        <StatGrid
          stats={[
            {
              label: "Coordinates",
              value: coordinates,
              span: true,
              onCopy: () => void handleCopyCoordinates(),
            },
          ]}
        />
      </section>
    ),

    // Asks Open-Meteo for the 0.1° cell round the place and nothing more
    // (ADR 0038), and only on this press.
    weather: () => (
      <section className={classes.section}>
        <SectionHeader title={WEATHER.title} />
        <PlaceWeather
          key={`${current.id}:${current.latitude},${current.longitude},${current.elevation ?? ""}`}
          point={current}
          elevationM={current.elevation ?? null}
        />
      </section>
    ),

    // A sharee sees the owner's pick, read-only, and nothing when none is set.
    gauge: () =>
      current.gaugeId || isOwnedPlace ? (
        <section className={classes.section}>
          <SectionHeader
            title={placeSectionTitle("gauge", copy.gauge, {
              owned: isOwnedPlace,
              shared: isShared,
              filled: Boolean(current.gaugeId),
            })}
          />
          <PlaceGauge
            latitude={current.latitude}
            longitude={current.longitude}
            gaugeId={current.gaugeId}
            owned={isOwnedPlace}
            tripDates={tripLogs.map((t) => t.date)}
            onChange={(id) => void setGauge(id)}
          />
        </section>
      ) : null,

    attributes: () =>
      attributes.length > 0 ? (
        <section className={classes.section}>
          <SectionHeader
            title={placeSectionTitle(
              "attributes",
              placeAttributesTitle(placeType?.name ?? null),
              { owned: isOwnedPlace, shared: isShared, filled: true },
            )}
          />
          <dl className={classes.table}>
            {attributes.map(({ key, label, text }) => (
              <div key={key} className={classes.tableRow}>
                <dt>{label}</dt>
                <dd className={classes.figure}>{text}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null,

    // PARKED VALUES (api/src/__tests__/placeCopy.test.ts). Named for the CONDITION: a type change strands
    // what the new type has no field for, and a copy carries values keyed by
    // the sender's fields. Owner-only, and structurally so: the server never
    // sends `foreignFields` on a row a sharee can reach.
    doesntFit: () =>
      foreignFields.length > 0 ? (
        <section className={classes.section}>
          <SectionHeader title={copy.doesntFit} count={foreignFields.length} />
          <p className={classes.muted}>
            {current.forkedFromId
              ? copy.doesntFitCopied
              : copy.doesntFitTypeChange}
          </p>
          {/* A CARD PER ROW: every row here is a decision, and the three verbs
              live in the dialog it opens. */}
          {foreignFields.map((item) => (
            <Row
              key={item.key}
              leading={<IconTile icon="help" hue="var(--color-accent)" />}
              title={item.label}
              subtitle={foreignValueText(item)}
              trailing={<Icon idea="disclosure" size={18} aria-hidden />}
              onOpen={() => setForeignKey(item.key)}
            />
          ))}
        </section>
      ) : null,

    notes: () => {
      const hasNotes = Boolean(current.notes && current.notes.trim());
      return (
        <section className={classes.section}>
          <SectionHeader
            title={placeSectionTitle("notes", copy.notes, {
              owned: isOwnedPlace,
              shared: isShared,
              filled: hasNotes,
            })}
          />
          {hasNotes ? (
            <NoteBody notes={current.notes ?? ""} />
          ) : (
            <p className={classes.muted}>{copy.notesEmpty}</p>
          )}
        </section>
      );
    },

    sources: () =>
      sources.length > 0 ? (
        <section className={classes.section}>
          <SectionHeader
            title={placeSectionTitle("sources", copy.sources, {
              owned: isOwnedPlace,
              shared: isShared,
              filled: true,
            })}
            count={sources.length}
          />
          {sources.map((source, index) => (
            <Row
              key={index}
              leading={
                <IconTile
                  icon={source.linkable ? "openExternal" : "link"}
                  hue="var(--color-neutral)"
                />
              }
              title={source.label}
              subtitle={source.linkable ? source.host : undefined}
              href={source.linkable ? source.url : undefined}
              external={source.linkable}
            />
          ))}
        </section>
      ) : null,

    photos: () => (
      <section className={classes.section}>
        <SectionHeader
          title={placeSectionTitle("photos", copy.photos, {
            owned: isOwnedPlace,
            shared: isShared,
            filled: visualMedia.length > 0,
          })}
          count={visualMedia.length > 0 ? visualMedia.length : undefined}
        />
        {visualMedia.length > 0 ? (
          <PlaceSlideshow
            media={visualMedia}
            onDelete={isOwnedPlace ? setFileToDelete : undefined}
          />
        ) : (
          <p className={classes.muted}>{copy.photosEmpty}</p>
        )}
        {isOwnedPlace && (
          <MediaUpload
            category="visual"
            linkedType="place"
            linkedId={current.id}
            onUploaded={(item) => {
              setPlaceMedia((prev) => [...prev, item]);
              onQuotaChanged();
            }}
          />
        )}
      </section>
    ),

    // One route per place (the API enforces it): a FILE, so the row is a real
    // link (middle-click, save as), wearing the glyph and hue a track wears on
    // Ways. Sources are not a section: they are an attribute, and sit with the
    // others.
    route: () => (
      <section className={classes.section}>
        <SectionHeader
          title={placeSectionTitle("route", copy.route, {
            owned: isOwnedPlace,
            shared: isShared,
            filled: Boolean(track || drawnRoute),
          })}
        />
        {drawnRoute ? (
          <Row
            leading={<IconTile icon="route" hue="var(--hue-route)" />}
            title={drawnRoute.name}
            subtitle={`Drawn route · ${formatDistanceM(routeLengthM(drawnRoute.points))}`}
            onOpen={() => {
              const bounds = boundsOfPoints(drawnRoute.points);
              if (bounds) onFocusBounds(bounds);
            }}
            trailing={
              <>
                <IconButton
                  icon="forward"
                  label="Open way"
                  onClick={() => onOpenRoute(drawnRoute)}
                />
                {isOwnedPlace && (
                  <IconButton
                    icon="unlink"
                    label="Unlink from this place"
                    onClick={() => {
                      updateRoute(drawnRoute.id, { placeId: null })
                        .then(() => {
                          onRoutesChanged();
                          toast.done("Route unlinked.");
                        })
                        .catch((err: unknown) =>
                          toast.error(
                            messageFromError(
                              err,
                              "Couldn't unlink that route.",
                            ),
                          ),
                        );
                    }}
                  />
                )}
              </>
            }
          />
        ) : track ? (
          <Row
            leading={<IconTile icon="track" hue="var(--hue-track)" />}
            title={mediaDisplayName(track)}
            subtitle="Click to download"
            href={track.displayUrl}
            download={track.filename}
            trailing={
              isOwnedPlace ? (
                // An import or a recording is the user's own file, so it comes
                // off the place and stays; only a file uploaded here has no life
                // apart from the place and can only be deleted.
                track.origin !== null ? (
                  <IconButton
                    icon="unlink"
                    label="Unlink from this place"
                    onClick={() => {
                      linkMediaToPlace(track.id, null)
                        .then(() => {
                          reloadPlaceMedia();
                          toast.done("Route unlinked.");
                        })
                        .catch((err: unknown) =>
                          toast.error(
                            messageFromError(
                              err,
                              "Couldn't unlink that route.",
                            ),
                          ),
                        );
                    }}
                  />
                ) : (
                  <IconButton
                    icon="delete"
                    label={`Delete the track ${mediaDisplayName(track)}`}
                    tone="danger"
                    onClick={() => setFileToDelete(track)}
                  />
                )
              ) : undefined
            }
          />
        ) : (
          <p className={classes.muted}>{copy.routeEmpty}</p>
        )}
        {isOwnedPlace && (
          <div>
            <Button
              compact
              icon={drawnRoute || track ? "replace" : "add"}
              onClick={() => setAddingWay(true)}
            >
              {drawnRoute || track
                ? ADD_WAY.copy.replaceTitle
                : ADD_WAY.copy.title}
            </Button>
          </div>
        )}
      </section>
    ),

    // NAVIGATIONAL ONLY: a link grants no visibility (ADR 0019;
    // api/src/__tests__/placeLinks.test.ts), so this is the owner's own filing
    // and a recipient is sent no links at all.
    linkedPlaces: () => (
      <section className={classes.section}>
        <SectionHeader
          title={copy.linkedPlaces}
          count={linkedPlaces.length > 0 ? linkedPlaces.length : undefined}
        />
        {linkedPlaces.length === 0 ? (
          <p className={classes.muted}>{copy.linkedPlacesEmpty}</p>
        ) : (
          linkedPlaces.map((linked) => {
            const linkedType = placeTypes.find(
              (type) => type.id === linked.placeTypeId,
            );
            return (
              <Row
                key={linked.id}
                leading={
                  <IconTile
                    icon={placeTypeLucideIcon(linkedType?.iconKey ?? "map-pin")}
                    hue={linkedType?.color ?? "var(--color-accent)"}
                  />
                }
                title={linked.name}
                onOpen={() => setSelectedPlaceID(linked.id)}
                trailing={
                  <Menu
                    label={`Options for ${linked.name}`}
                    title={linked.name}
                    placement="bottom-end"
                    entries={[
                      {
                        id: "unlink",
                        label: copy.unlinkFromPlace,
                        icon: "unlink",
                        onSelect: () =>
                          void writeLinks(
                            linkedPlaces
                              .filter((row) => row.id !== linked.id)
                              .map((row) => row.id),
                            copy.unlinked,
                            copy.unlinkFailed,
                          ),
                      },
                    ]}
                    trigger={(props) => (
                      <IconButton
                        {...props}
                        icon="overflow"
                        label={`Options for ${linked.name}`}
                      />
                    )}
                  />
                }
              />
            );
          })
        )}
        <PlacePicker
          label={copy.linkAPlace}
          places={places.filter(
            (row) =>
              row.id !== current.id &&
              !linkedPlaces.some((l) => l.id === row.id),
          )}
          onSelect={(picked) =>
            void writeLinks(
              [...linkedPlaces.map((row) => row.id), picked.id],
              placeLinkedToast(picked.name),
              copy.linkFailed,
            )
          }
        />
        <p className={classes.muted}>{copy.linkAPlaceHint}</p>
      </section>
    ),

    trips: () => (
      <section className={classes.section}>
        <SectionHeader
          title={copy.trips}
          count={tripLogs.length > 0 ? tripLogs.length : undefined}
        />
        {loadingTrips ? (
          <p className={classes.muted} role="status">
            Loading trips…
          </p>
        ) : tripLogs.length === 0 ? (
          <p className={classes.muted}>
            {isOwnedPlace ? copy.tripsEmpty : copy.tripsShared}
          </p>
        ) : (
          tripLogs.map((trip) => (
            <Row
              key={trip.id}
              leading={
                <IconTile
                  icon={tripTypeLook(primaryTripType(trip.types)).icon}
                  hue={tripTypeLook(primaryTripType(trip.types)).hue}
                />
              }
              title={formatDateKey(trip.date)}
              subtitle={trip.notes ?? undefined}
              onOpen={() => onOpenTrip(trip.id)}
            />
          ))
        )}
      </section>
    ),

    sharedWith: () => (
      <section className={classes.section}>
        <SectionHeader
          title={copy.sharedWith}
          count={sharedNames.length > 0 ? sharedNames.length : undefined}
        />
        <p className={sharedNames.length > 0 ? classes.notes : classes.muted}>
          {sharedWithNode ?? copy.sharedWithEmpty}
        </p>
        <Row
          leading={<IconTile icon="shareFriend" hue="var(--color-accent)" />}
          title={copy.shareWithFriend}
          onOpen={() => setShowShareDialog(true)}
        />
      </section>
    ),
  };
  const sectionKeys = contractSectionsFor(PLACE_PAGE, "web", isOwnedPlace);

  return (
    <>
      <RunVerbRequest
        request={verbRequest}
        run={(id) => verbRunners[id]()}
        onConsumed={onVerbRequestConsumed}
      />
      <div className={classes.root}>
        <Hero
          title={current.name}
          onBack={onBack}
          backLabel="Back to Places"
          actions={
            <>
              <Menu
                label={`Actions for ${current.name}`}
                title={current.name}
                placement="bottom-end"
                entries={entries}
                trigger={(props) => (
                  <IconButton
                    {...props}
                    icon="overflow"
                    label={`Actions for ${current.name}`}
                  />
                )}
              />
            </>
          }
        />

        <div className={classes.body}>
          {sectionKeys.map((key) => (
            <Fragment key={key}>{sections[key]()}</Fragment>
          ))}
        </div>
      </div>

      {isOwnedPlace && (
        <AddWayDialog
          open={addingWay}
          placeId={current.id}
          placeName={current.name}
          routes={routes}
          currentUserId={currentUserId}
          media={placeMedia}
          onClose={() => setAddingWay(false)}
          onDrawRoute={() => onDrawRoute(current.id)}
          onFilled={() => {
            reloadPlaceMedia();
            onRoutesChanged();
            onQuotaChanged();
          }}
        />
      )}

      <PlaceDialog
        place={current}
        open={showEdit && !pickingCoords}
        onClose={() => setShowEdit(false)}
        onSaved={onRefetch}
        onPickCoords={onPickCoords}
        onCancelPickCoords={onCancelPickCoords}
        customFieldDefs={placeCustomFieldDefs}
        onCustomFieldDefsChange={onPlaceCustomFieldDefsChange}
        placeTypes={placeTypes}
        onMediaChanged={reloadPlaceMedia}
      />

      {/* The three actions on one parked value, as Logjam GPS's sheet: the
          title says what the dialog is for, and the value is shown as the
          same label/value row it was clicked from. */}
      <Dialog
        open={foreignItem !== null && !confirmDiscard}
        title="What should this become?"
        onClose={() => setForeignKey(null)}
        dismissible={!foreignFieldBusy}
      >
        {foreignItem && (
          <div className={classes.foreignActions}>
            <dl className={classes.table}>
              <div className={classes.tableRow}>
                <dt>{foreignItem.label}</dt>
                <dd className={classes.figure}>
                  {foreignValueText(foreignItem)}
                </dd>
              </div>
            </dl>
            {/* HIDDEN on a built-in key: the system definition already owns
                it and the API answers 409, so it is not an action that is
                unavailable, it is one that does not exist for this value. */}
            {!isReservedFieldKey(foreignItem.key) && (
              <Row
                leading={<IconTile icon="add" hue="var(--color-accent)" />}
                title="Create a new attribute for this place type"
                onOpen={() => runForeignFieldAction("adopt")}
                disabled={foreignFieldBusy}
              />
            )}
            <Row
              leading={<IconTile icon="notes" hue="var(--color-accent)" />}
              title="Add to notes as text"
              onOpen={() => runForeignFieldAction("notes")}
              disabled={foreignFieldBusy}
            />
            <Row
              leading={<IconTile icon="delete" hue="var(--color-accent)" />}
              title="Discard"
              onOpen={() => setConfirmDiscard(true)}
              disabled={foreignFieldBusy}
            />
          </div>
        )}
      </Dialog>

      {/* The only one of the three that LOSES something, so it asks first. */}
      <ConfirmDialog
        open={foreignItem !== null && confirmDiscard}
        copy={
          foreignItem && {
            confirmTitle: `Discard "${foreignItem.label}"?`,
            confirmBody:
              "The value is removed from this place. This can't be undone.",
            confirmLabel: "Discard",
            tone: "destructive",
          }
        }
        busy={foreignFieldBusy}
        onConfirm={() => runForeignFieldAction("discard")}
        onClose={() => setConfirmDiscard(false)}
      />

      <ConfirmDialog
        open={fileToDelete != null}
        copy={
          fileToDelete && {
            confirmTitle: `Delete ${fileToDelete.filename}?`,
            confirmBody: "The file is deleted and can't be brought back.",
            confirmLabel: "Delete",
            tone: "destructive",
          }
        }
        busy={deletingFile}
        onConfirm={handleDeleteFile}
        onClose={() => setFileToDelete(null)}
      />

      {isOwnedPlace && (
        <ShareDialog
          title={`Share ${current.name}`}
          kind="place"
          friends={friends}
          open={showShareDialog}
          onClose={() => setShowShareDialog(false)}
          listShares={() => getPlaceShares(current.id)}
          share={(userId) => sharePlaceWith(current.id, userId)}
          unshare={(userId) => unsharePlaceWith(current.id, userId)}
        />
      )}

      <ConfirmDialog
        open={confirmCopyAndRemove}
        copy={{
          confirmTitle: copyAndRemoveCopy.title,
          confirmBody: copyAndRemoveCopy.body,
          confirmLabel: "Save a copy and remove",
          tone: "filled",
        }}
        busy={copying}
        onConfirm={() => handleCopyPlace(true)}
        onClose={() => setConfirmCopyAndRemove(false)}
      />

      {/* The one promise every surface makes about dropping a share —
          `removeShareConfirm`, not this page's own wording. */}
      <ConfirmDialog
        open={confirmRemove}
        copy={{
          confirmTitle: removeCopy.title,
          confirmBody: removeCopy.body,
          confirmLabel: "Remove",
          tone: "filled",
        }}
        busy={removing}
        onConfirm={handleRemoveShare}
        onClose={() => setConfirmRemove(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        copy={deleteCopy}
        busy={deleting}
        onConfirm={handleDelete}
        onClose={() => setShowDeleteConfirm(false)}
      />

      <TripLogDialog
        open={showTripLogDialog && !pickingCoords}
        onClose={() => {
          setShowTripLogDialog(false);
          setEditingTripLog(undefined);
        }}
        onSaved={() => {
          setShowTripLogDialog(false);
          setEditingTripLog(undefined);
          refreshTripLogs();
        }}
        places={places}
        defaultPlaceId={current.id}
        tripLog={editingTripLog}
        customFieldDefs={customFieldDefs}
        onCustomFieldDefsChange={onCustomFieldDefsChange}
        existingTripTypes={existingTripTypes}
      />
    </>
  );
}

export default PlaceDetailPanel;
