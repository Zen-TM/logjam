// One trip: "what did I do that day?" (Logjam GPS's `TripDetailScreen`).
//
// A PANEL, NOT A DIALOG (DESIGN.md §6). Looking at something is not a task
// with an end — you arrive at it, follow a place out of it, come back, leave
// it open beside the map — so it is a page like a place's and a way's, and the
// form that edits it is the dialog this page raises. It was a dialog until
// 2026-09-19, which meant the only way to READ a trip put the whole app behind
// a modal, and opening the place it linked had to close the trip first.
import { useEffect, useState } from "react";
import {
  EllipsisVertical,
  MapPin,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  attributeRows,
  formatFieldValue,
  formatTripDate,
  mediaCategory,
  tripTypeLabel,
  type MediaItem,
  type ScopedCustomFieldDef,
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
  onClose,
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
  onClose: () => void;
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
  useEffect(() => {
    if (!tripLog) {
      setMedia([]);
      return;
    }
    const { id } = tripLog;
    setMediaLoading(true);
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
      toast.error(messageFromError(err, "Couldn't delete this trip. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  if (!tripLog) {
    return (
      <div className={classes.root}>
        <Hero
          title="Trip"
          onBack={onBack}
          backLabel="Back to Logs"
          actions={<IconButton icon={X} label="Close panel" onClick={onClose} />}
        />
        <div className={classes.body}>
          <EmptyState
            icon={Pencil}
            title="No trip selected"
            body="Pick one from Logs, or from the place it visited."
          />
        </div>
      </div>
    );
  }

  const trip = tripLog;
  const photoCount = media.filter((item) => mediaCategory(item.mediaType) !== "track").length;
  const trackCount = media.length - photoCount;
  const attributes = attributeRows(customFieldDefs, trip.customFields);
  const title = tripTitle(trip);

  // A VERB is in the ⋯ (DESIGN.md §7). Edit raises the form this page is the
  // read of; Delete sits below the rule with the verbs that end things.
  const entries: MenuEntry[] = [
    { id: "edit", label: "Edit trip", icon: Pencil, disabled: deleting, onSelect: () => setEditing(true) },
    { id: "sep", separator: true },
    {
      id: "delete",
      label: "Delete",
      icon: Trash2,
      danger: true,
      disabled: deleting,
      onSelect: () => setConfirmingDelete(true),
    },
  ];

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
                  <IconButton {...props} icon={EllipsisVertical} label={`Actions for ${title}`} />
                )}
              />
              <IconButton icon={X} label="Close panel" onClick={onClose} />
            </>
          }
        />

        <div className={classes.body}>
          <div className={classes.summary}>
            <p className={classes.date}>{formatTripDate(trip.date)}</p>
            <div className={classes.pills}>
              {trip.types.length > 0 ? (
                trip.types.map((type) => (
                  <StatusPill key={type} label={tripTypeLabel(type)} icon={tripTypeLook(type).icon} />
                ))
              ) : (
                <StatusPill label="No type set" tone="muted" icon={tripTypeLook(null).icon} />
              )}
            </div>
          </div>

          <section className={classes.section}>
            <SectionHeader title="Places" count={trip.places.length || undefined} />
            {trip.places.length === 0 ? (
              <p className={classes.muted}>No places linked. Edit the trip to add one.</p>
            ) : (
              trip.places.map((place) => (
                <Row
                  key={place.id}
                  title={place.name}
                  leading={<IconTile icon={MapPin} hue="var(--theme-accent)" />}
                  onOpen={() => onOpenPlace(place.id)}
                />
              ))
            )}
          </section>

          <section className={classes.section}>
            <SectionHeader title="Photos & videos" count={photoCount || undefined} />
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
                emptyText="No photos or videos yet."
              />
            )}
          </section>

          <section className={classes.section}>
            <SectionHeader title="Tracks" count={trackCount || undefined} />
            {!mediaLoading && (
              <MediaGallery
                media={media}
                variant="tracks"
                canDelete={canManageMedia}
                onDeleted={handleMediaDeleted}
                emptyText="No tracks yet."
              />
            )}
          </section>

          <section className={classes.section}>
            <SectionHeader title="Notes" />
            {trip.notes ? (
              <p className={classes.notes}>{trip.notes}</p>
            ) : (
              <p className={classes.muted}>No notes</p>
            )}
          </section>

          {attributes.length > 0 && (
            <section className={classes.section}>
              <SectionHeader title="Trip attributes" />
              <dl className={classes.attributes}>
                {attributes.map(([key, label, value, type]) => (
                  <div key={key} className={classes.attribute}>
                    <dt>{label}</dt>
                    <dd>{formatFieldValue(value, type)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
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
        title="Delete this trip?"
        message="Its photos, videos and tracks go too. The places it links to stay. This can't be undone."
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onClose={() => setConfirmingDelete(false)}
      />
    </>
  );
}

export default TripDetailPanel;
