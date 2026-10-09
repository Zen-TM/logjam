// One place: what it is, what this kind of place records, and what can be done
// with it.
//
// EVERY ATTRIBUTE IS READ FROM ITS DEFINITION. Four canyon scalars used to be
// printed by name — quality, pitches, longest pitch, hours — above a generic
// loop over the type's definitions that had since come to include those very
// fields, so a canyon listed each of them TWICE, once with a unit and once
// without ("Longest Pitch: 15m" and "Longest pitch: 15"). The fix is the one
// PlaceDialog got: the definitions are the list, and `SYSTEM_FIELD_DEFS` is
// where a built-in's unit lives.
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
  type CSSProperties,
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
  mediaCategory,
  primaryTripType,
  placeDeleteConfirm,
  removeShareConfirm,
  contractSectionsFor,
  PLACE_PAGE,
  PLACE_PAGE_PRIMARY_VERBS,
  placeAttributesTitle,
  placeSources,
  placeStatus,
  placeStatusLabel,
  placeVerbs,
  systemFieldDef,
  type SectionKeysOn,
  type MediaItem,
  type ScopedCustomFieldDef,
  type TripLogCustomFieldDef,
} from "@logjam/shared";
import classes from "./PlaceDetailPanel.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import PlaceDialog from "../../dialogs/PlaceDialog";
import ShareDialog from "../../dialogs/ShareDialog";
import TripLogDialog from "../../dialogs/TripLogDialog";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import type {
  TPlace,
  TFriend,
  TTripLog,
  TPlaceShare,
  TPlaceType,
} from "../../../placeUtils";
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
} from "../../../placeUtils";
import PlaceSlideshow from "../../media/PlaceSlideshow";
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
  StatusPill,
} from "../../../ui";
import { formatCanyonGrade } from "../../../placeUtils";

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

/** The value as it is READ: the stored answer plus the unit its definition
 *  declares ("15 m"). Only a built-in carries one, and only where the label
 *  does not already say it — "Hours" says hours. */
function displayValue(def: TripLogCustomFieldDef, raw: unknown): string | null {
  const text = formatCustomFieldValue(raw, def.type);
  if (text == null) return null;
  const unit = systemFieldDef(def.key)?.unit;
  return unit ? `${text} ${unit}` : text;
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
  onSharePlace,
  verbRequest,
  onVerbRequestConsumed,
  customFieldDefs,
  placeTypes,
  onCustomFieldDefsChange,
  placeCustomFieldDefs,
  onPlaceCustomFieldDefsChange,
  onQuotaChanged,
  onRefetchTripLogs,
  onAfterDelete,
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
  /** A trip is READ on its own page (DESIGN.md §4), not in a dialog over this one. */
  onOpenTrip: (tripLogId: string) => void;
  /** Start a map over this place; the menu names the two kinds. */
  onMakeMap: (place: TPlace, kind: "topo" | "geopdf") => void;
  /** Open the share-or-export dialog on this place, the one the list uses. */
  onSharePlace: (placeId: string) => void;
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
  // Retrigger the global Trip Logs list/search after a trip is created or
  // deleted here — the place-scoped refetch below only updates this panel.
  onRefetchTripLogs: () => void;
  // Leave the (now-empty) place-detail panel after a delete so it doesn't
  // dead-end in "No place selected" (PLACE-8 / MOBILE-4).
  onAfterDelete: () => void;
}) {
  const toast = useToast();
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Copy and Remove shipped with NO confirm while plain Remove had one — the
  // more consequential button asking less. `copyAndRemoveConfirm` is the same
  // wording Logjam GPS shows.
  const [confirmCopyAndRemove, setConfirmCopyAndRemove] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [trackToDelete, setTrackToDelete] = useState<MediaItem | null>(null);
  const [deletingTrack, setDeletingTrack] = useState(false);
  const [copied, setCopied] = useState(false);

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
   *  answered ones: a form asks every question, a page reports the answers. */
  const attributes = useMemo(() => {
    if (!place) return [];
    return defsForType(placeCustomFieldDefs, place.placeTypeId)
      .map((def) => ({
        def,
        text: displayValue(def, fieldValue(place.fieldValues, def.key)),
      }))
      .filter(
        (row): row is { def: ScopedCustomFieldDef; text: string } =>
          row.text != null,
      );
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
  // (dev) runs each effect twice with identical deps, which fired
  // GET /places/:id and GET /places/:id/shares twice per place selection
  // (PLACE-13). The refs survive the double-invoke, so the second identical
  // run skips. Each key includes every dep that should trigger a refetch.
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
        // FEUI-013: a slower response for a place/dialog-state the user has
        // since navigated away from must not overwrite what's now showing —
        // same stale-response race as FEUI-006 below. The ref already moved
        // on if this fetch is no longer current.
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
        // FEUI-006: a slower place-A response landing after a since-selected
        // place-B's must not overwrite B's panel. The dedup ref has already
        // moved to B by the time this resolves if that happened.
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

  const coordinates = `${current.latitude.toFixed(4)}, ${current.longitude.toFixed(4)}`;

  /** The one thing a coordinate is FOR: getting it into whatever the user is
   *  navigating with. The glyph answers for two seconds — a toast for a copy
   *  is a notification about something the user is watching happen. */
  async function handleCopyCoordinates() {
    try {
      await navigator.clipboard.writeText(coordinates);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
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
      toast.success("Place deleted.");
      // Return to the places list — the detail panel has nothing to show now.
      onAfterDelete();
    } catch (err) {
      console.error(err);
      toast.error(
        messageFromError(err, "Couldn't delete place. Please try again."),
      );
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
      toast.success("Removed.");
    } catch (err) {
      console.error(err);
      toast.error(
        messageFromError(err, "Couldn't remove that place. Please try again."),
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
        toast.success(
          andRemove ? "Copied, and the shared one removed." : "Copied.",
        );
      }
      onRefetch();
    } catch (err) {
      console.error(err);
      toast.error(
        messageFromError(err, "Couldn't copy place. Please try again."),
      );
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
        // FEUI-006: same stale-response guard as the detail-fetch effect —
        // don't apply a response for a place the user has since left.
        if (detailFetchKeyRef.current !== requestedId) return;
        setPlaceMedia(detail.media);
      })
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't refresh media."));
      });
    onQuotaChanged();
  }

  function refreshTripLogs() {
    getTripLogs(current.id)
      .then(setTripLogs)
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't refresh trip logs."));
      });
    // Also refresh the global Trip Logs list/search (separate query).
    onRefetchTripLogs();
  }

  async function handleDeleteTrack() {
    if (!trackToDelete) return;
    setDeletingTrack(true);
    try {
      await deleteMedia(trackToDelete.id);
      setPlaceMedia((prev) => prev.filter((m) => m.id !== trackToDelete.id));
      setTrackToDelete(null);
      onQuotaChanged();
    } catch (err) {
      console.error(err);
      toast.error(
        messageFromError(err, "Couldn't delete track. Please try again."),
      );
    } finally {
      setDeletingTrack(false);
    }
  }

  const busy = copying || deleting || removing;

  // Exhaustive by type: every verb the contract gives Logjam Web has a runner.
  const verbRunners: Record<WebPlaceVerbId, () => void> = {
    open: () => {}, // A row's verb; this page is what it opens.
    edit: () => setShowEdit(true),
    logTrip: () => {
      setEditingTripLog(undefined);
      setShowTripLogDialog(true);
    },
    makeTopo: () => onMakeMap(current, "topo"),
    makeGeoPdf: () => onMakeMap(current, "geopdf"),
    share: () => onSharePlace(current.id),
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
  const track =
    placeMedia.find((m) => mediaCategory(m.mediaType) === "track") ?? null;

  const copy = PLACE_PAGE.copy;
  const sources = placeSources(current.fieldValues);
  const placeStatusKey = isOwnedPlace
    ? loadingTrips
      ? null
      : placeStatus({ syncRole: "owner" }, tripLogs.length)
    : placeStatus({ syncRole: "shared" }, 0);
  const grade = formatCanyonGrade(current.fieldValues);
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
        {/* WHAT IT IS, in the type's own glyph and colour, then where it
            stands: a fact, not a field, so a line and pills rather than a row
            in a table. The hue goes in as a custom property the stylesheet
            reads, never as an inline colour (DESIGN.md §6). */}
        <p
          className={classes.identity}
          style={{ "--tile-hue": placeType?.color } as CSSProperties}
        >
          {/* A lookup in lucide's static exports, not a component made in
              render: the same key is the same component every time. */}
          <TypeGlyph size={16} aria-hidden className={classes.typeGlyph} />
          {placeType?.name ?? "Unknown type"}
        </p>
        <div className={classes.pills}>
          {grade ? <StatusPill label={grade} tone="outline" /> : null}
          {placeStatusKey ? (
            <StatusPill
              label={placeStatusLabel(placeStatusKey, tripLogs.length)}
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
        <Row
          leading={<IconTile icon="place" hue="var(--color-accent)" />}
          title={coordinates}
          trailing={
            <IconButton
              icon={copied ? "done" : "copy"}
              label={`Copy the coordinates of ${current.name}`}
              onClick={() => void handleCopyCoordinates()}
            />
          }
        />
      </section>
    ),

    attributes: () =>
      attributes.length > 0 ? (
        <section className={classes.section}>
          <SectionHeader
            title={placeAttributesTitle(placeType?.name ?? null)}
          />
          <dl className={classes.table}>
            {attributes.map(({ def, text }) => (
              <div key={def.key} className={classes.tableRow}>
                <dt>{def.label}</dt>
                <dd className={classes.figure}>{text}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null,

    // PARKED VALUES (§2.6). Named for the CONDITION: a type change strands
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
            title={hasNotes && isOwnedPlace ? copy.notesVisible : copy.notes}
          />
          <p className={hasNotes ? classes.notes : classes.muted}>
            {hasNotes ? current.notes : copy.notesEmpty}
          </p>
        </section>
      );
    },

    sources: () =>
      sources.length > 0 ? (
        <section className={classes.section}>
          <SectionHeader title={copy.sources} count={sources.length} />
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
          title={copy.photos}
          count={visualMedia.length > 0 ? visualMedia.length : undefined}
        />
        {visualMedia.length > 0 ? (
          <PlaceSlideshow media={visualMedia} />
        ) : (
          <p className={classes.muted}>{copy.photosEmpty}</p>
        )}
      </section>
    ),

    // One route per place (the API enforces it): a FILE, so the row is a real
    // link (middle-click, save as), wearing the glyph and hue a track wears on
    // Ways. Sources are not a section: they are an attribute, and sit with the
    // others.
    route: () => (
      <section className={classes.section}>
        <SectionHeader title={copy.route} />
        {track ? (
          <Row
            leading={<IconTile icon="track" hue="var(--hue-track)" />}
            title={track.filename}
            subtitle="Click to download"
            href={track.displayUrl}
            download={track.filename}
            trailing={
              isOwnedPlace ? (
                <IconButton
                  icon="delete"
                  label={`Delete the track ${track.filename}`}
                  tone="danger"
                  onClick={() => setTrackToDelete(track)}
                />
              ) : undefined
            }
          />
        ) : (
          <p className={classes.muted}>{copy.routeEmpty}</p>
        )}
      </section>
    ),

    // NAVIGATIONAL ONLY: a link grants no visibility (§2.5), so this is the
    // owner's own filing and a recipient is sent no links at all.
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
              />
            );
          })
        )}
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
          onOpen={() => onSharePlace(current.id)}
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
        title={`Discard "${foreignItem?.label ?? ""}"?`}
        message="The value is removed from this place. This can't be undone."
        confirmLabel="Discard"
        confirmColor="error"
        busy={foreignFieldBusy}
        onConfirm={() => runForeignFieldAction("discard")}
        onClose={() => setConfirmDiscard(false)}
      />

      <ConfirmDialog
        open={trackToDelete != null}
        title="Delete track?"
        message={
          <>
            This permanently deletes the track <b>{trackToDelete?.filename}</b>.
            This cannot be undone.
          </>
        }
        busy={deletingTrack}
        onConfirm={handleDeleteTrack}
        onClose={() => setTrackToDelete(null)}
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
        title={copyAndRemoveCopy.title}
        message={copyAndRemoveCopy.body}
        busy={copying}
        onConfirm={() => handleCopyPlace(true)}
        onClose={() => setConfirmCopyAndRemove(false)}
      />

      {/* The one promise every surface makes about dropping a share —
          `removeShareConfirm`, not this page's own wording. */}
      <ConfirmDialog
        open={confirmRemove}
        title={removeCopy.title}
        message={removeCopy.body}
        confirmLabel="Remove"
        busy={removing}
        onConfirm={handleRemoveShare}
        onClose={() => setConfirmRemove(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        title={deleteCopy.confirmTitle}
        message={deleteCopy.confirmBody}
        confirmLabel="Delete"
        confirmColor="error"
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
