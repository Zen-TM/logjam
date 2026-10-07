// One trip: "what did I do that day?" (Logjam GPS's `TripDetailScreen`).
//
// A PANEL, NOT A DIALOG (DESIGN.md §4). Looking at something is not a task
// with an end — you arrive at it, follow a place out of it, come back, leave
// it open beside the map — so it is a page like a place's and a way's, and the
// form that edits it is the dialog this page raises. It was a dialog until
// 2026-09-19, which meant the only way to READ a trip put the whole app behind
// a modal, and opening the place it linked had to close the trip first.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  attributeRows,
  contractSectionKeys,
  formatFieldValue,
  formatTripDate,
  mediaCategory,
  TRIP_PAGE,
  tripDeleteConfirm,
  tripTypeLabel,
  tripVerbs,
  type MediaItem,
  type ScopedCustomFieldDef,
  type SectionKeysOn,
  type TripVerbId,
} from "@logjam/shared";
import type { TPlace, TTripLog } from "../../../placeUtils";
import { deleteTripLog, getTripLog, tripTitle } from "../../../placeUtils";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import MediaGallery from "../../media/MediaGallery";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import TripLogDialog from "../../dialogs/TripLogDialog";
import { tripTypeLook } from "./tripTypeIcon";
import {
  EmptyState,
  Hero,
  IconButton,
  IconTile,
  Menu,
  Row,
  SectionHeader,
  StatusPill,
  type MenuEntry,
} from "../../../ui";
import classes from "./TripDetailPanel.module.css";

function TripDetailPanel({
  tripLog,
  places,
  customFieldDefs,
  onCustomFieldDefsChange,
  existingTripTypes,
  onBack,
  onOpenPlace,
  onRefetchTripLogs,
  onRefetchPlaces,
  onQuotaChanged,
  onPickCoords,
  pickingCoords,
  onAfterDelete,
  canManageMedia = true,
}: {
  tripLog: TTripLog | undefined;
  places: TPlace[];
  customFieldDefs: ScopedCustomFieldDef[];
  onCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  existingTripTypes: string[];
  /** Back to the logbook this trip belongs to — the same call a place's page
   *  and a way's page make, whichever surface opened it. */
  onBack: () => void;
  onOpenPlace: (placeId: string) => void;
  onRefetchTripLogs: () => void;
  onRefetchPlaces: () => void;
  onQuotaChanged: () => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  pickingCoords: boolean;
  /** Leave the (now-empty) page after a delete rather than dead-ending. */
  onAfterDelete: () => void;
  canManageMedia?: boolean;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const toast = useToast();

  // The trip's media, with fresh presigned URLs: the row this page was opened
  // from comes from a list that does not carry any.
  // Another trip shows its files loading, and no trip empties them, during
  // render; the effect fetches.
  const tripLogId = tripLog?.id ?? null;
  const [mediaFor, setMediaFor] = useState<string | null>(null);
  if (tripLogId !== mediaFor) {
    setMediaFor(tripLogId);
    if (tripLogId === null) setMedia([]);
    else setMediaLoading(true);
  }
  useEffect(() => {
    if (!tripLog) return;
    const { id } = tripLog;
    getTripLog(id)
      .then((full) => setMedia(full.media ?? []))
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load trip files."));
      })
      .finally(() => setMediaLoading(false));
  }, [tripLog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleMediaDeleted(id: string) {
    setMedia((prev) => prev.filter((m) => m.id !== id));
    onQuotaChanged();
  }

  async function handleDelete() {
    if (!tripLog) return;
    setDeleting(true);
    try {
      await deleteTripLog(tripLog.id);
      setConfirmingDelete(false);
      onRefetchTripLogs();
      onQuotaChanged();
      toast.success("Trip deleted.");
      onAfterDelete();
    } catch (err) {
      console.error(err);
      toast.error(
        messageFromError(err, "Couldn't delete this trip. Please try again."),
      );
    } finally {
      setDeleting(false);
    }
  }

  if (!tripLog) {
    return (
      <div className={classes.root}>
        <Hero title="Trip" onBack={onBack} backLabel="Back to Logs" />
        <div className={classes.body}>
          <EmptyState
            icon="edit"
            title="No trip selected"
            body="Pick one from Logs, or from the place it visited."
          />
        </div>
      </div>
    );
  }

  const trip = tripLog;
  const photoCount = media.filter(
    (item) => mediaCategory(item.mediaType) !== "track",
  ).length;
  const trackCount = media.length - photoCount;
  const attributes = attributeRows(customFieldDefs, trip.customFields);
  const title = tripTitle(trip);

  // A VERB is in the ⋯ (DESIGN.md §5), and which verbs, in what order and
  // under what words is `TRIP_VERBS`, the declaration the logbook's rows and
  // Logjam GPS draw from too. Edit raises the form this page is the read of.
  const verbRunners: Record<TripVerbId, () => void> = {
    open: () => {}, // A row's verb; this page is what it opens.
    edit: () => setEditing(true),
    delete: () => setConfirmingDelete(true),
  };
  const entries: MenuEntry[] = tripVerbs("page").flatMap((verb) => {
    const item: MenuEntry = {
      id: verb.id,
      label: verb.label,
      icon: verb.icon,
      ...(verb.danger ? { danger: true } : {}),
      disabled: deleting,
      onSelect: verbRunners[verb.id],
    };
    return verb.separated
      ? [{ id: `${verb.id}-sep`, separator: true }, item]
      : [item];
  });
  const copy = TRIP_PAGE.copy;
  const deleteCopy = tripDeleteConfirm(1);

  // Exhaustive by type: a section the contract names and this page does not
  // draw, or the reverse, fails `tsc` (`TRIP_PAGE`, shared/src/contracts).
  const sections: Record<
    SectionKeysOn<typeof TRIP_PAGE, "web">,
    () => ReactNode
  > = {
    hero: () => (
      <div className={classes.summary}>
        <p className={classes.date}>{formatTripDate(trip.date)}</p>
        <div className={classes.pills}>
          {trip.types.length > 0 ? (
            trip.types.map((type) => (
              <StatusPill
                key={type}
                label={tripTypeLabel(type)}
                icon={tripTypeLook(type).icon}
              />
            ))
          ) : (
            <StatusPill
              label={copy.noType}
              tone="muted"
              icon={tripTypeLook(null).icon}
            />
          )}
        </div>
      </div>
    ),

    places: () => (
      <section className={classes.section}>
        <SectionHeader
          title={copy.places}
          count={trip.places.length || undefined}
        />
        {trip.places.length === 0 ? (
          <p className={classes.muted}>{copy.placesEmpty}</p>
        ) : (
          trip.places.map((place) => (
            <Row
              key={place.id}
              title={place.name}
              leading={<IconTile icon="place" hue="var(--color-accent)" />}
              onOpen={() => onOpenPlace(place.id)}
            />
          ))
        )}
      </section>
    ),

    photos: () => (
      <section className={classes.section}>
        <SectionHeader title={copy.photos} count={photoCount || undefined} />
        {mediaLoading ? (
          <p className={classes.muted} role="status">
            Loading files…
          </p>
        ) : (
          <MediaGallery
            media={media}
            variant="visual"
            canDelete={canManageMedia}
            onDeleted={handleMediaDeleted}
            emptyText={copy.photosEmpty}
          />
        )}
      </section>
    ),

    routes: () => (
      <section className={classes.section}>
        <SectionHeader title={copy.routes} count={trackCount || undefined} />
        {!mediaLoading && (
          <MediaGallery
            media={media}
            variant="tracks"
            canDelete={canManageMedia}
            onDeleted={handleMediaDeleted}
            emptyText={copy.routesEmpty}
          />
        )}
      </section>
    ),

    notes: () => (
      <section className={classes.section}>
        <SectionHeader title={copy.notes} />
        {trip.notes ? (
          <p className={classes.notes}>{trip.notes}</p>
        ) : (
          <p className={classes.muted}>{copy.notesEmpty}</p>
        )}
      </section>
    ),

    attributes: () =>
      attributes.length > 0 ? (
        <section className={classes.section}>
          <SectionHeader title={copy.attributes} />
          <dl className={classes.attributes}>
            {attributes.map(([key, label, value, type]) => (
              <div key={key} className={classes.attribute}>
                <dt>{label}</dt>
                <dd>{formatFieldValue(value, type)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null,
  };

  return (
    <>
      <div className={classes.root}>
        <Hero
          title={title}
          onBack={onBack}
          backLabel="Back to Logs"
          actions={
            <>
              <Menu
                label={`Actions for ${title}`}
                title={title}
                placement="bottom-end"
                entries={entries}
                trigger={(props) => (
                  <IconButton
                    {...props}
                    icon="overflow"
                    label={`Actions for ${title}`}
                  />
                )}
              />
            </>
          }
        />

        <div className={classes.body}>
          {contractSectionKeys(TRIP_PAGE, "web").map((key) => (
            <Fragment key={key}>{sections[key]()}</Fragment>
          ))}
        </div>
      </div>

      {/* Mounted while editing and hidden (not unmounted) while a coordinate
          is picked on the map, so the form survives the trip there and back. */}
      {editing && (
        <TripLogDialog
          open={!pickingCoords}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onRefetchTripLogs();
          }}
          places={places}
          tripLog={trip}
          customFieldDefs={customFieldDefs}
          onCustomFieldDefsChange={onCustomFieldDefsChange}
          existingTripTypes={existingTripTypes}
          onPickCoords={onPickCoords}
          onPlaceCreated={onRefetchPlaces}
        />
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={deleteCopy.confirmTitle}
        message={deleteCopy.confirmBody}
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onClose={() => setConfirmingDelete(false)}
      />
    </>
  );
}

export default TripDetailPanel;
