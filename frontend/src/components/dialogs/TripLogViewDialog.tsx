import { useEffect, useState } from "react";
import { MapPin, Pencil, Trash2 } from "lucide-react";
import {
  formatDateKey,
  formatTripDate,
  mediaCategory,
  tripAttributeEntries,
  tripTypeLabel,
  type MediaItem,
  type TripAttributeEntry,
  type TripLogCustomFieldDef,
} from "@logjam/shared";
import type { TTripLog } from "../../placeUtils";
import { deleteTripLog, getTripLog, tripTitle } from "../../placeUtils";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import MediaGallery from "../media/MediaGallery";
import { tripTypeLook } from "../sidebar/panels/tripTypeIcon";
import { Button, Dialog, IconTile, Row, SectionHeader, StatusPill } from "../../ui";
import ConfirmDialog from "./ConfirmDialog";
import classes from "./TripLogViewDialog.module.css";

function formatAttribute(entry: TripAttributeEntry): string {
  const { value, type } = entry;
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  // A date attribute is stored date-only; formatDateKey reads it in UTC.
  if (type === "date" && typeof value === "string") return formatDateKey(value);
  return String(value);
}

/**
 * One trip: "what did I do that day?" (Logjam GPS's `TripDetailScreen`). The
 * date and activities up top, then the places, the photos, the tracks, the
 * notes and the attributes it carries. Edit is the one primary action; Delete
 * is the destructive verb beside it and confirms first.
 */
function TripLogViewDialog({
  open,
  onClose,
  tripLog,
  customFieldDefs,
  onEdit,
  onDeleted,
  onOpenPlace,
  canManageMedia = true,
  onMediaChanged,
}: {
  open: boolean;
  onClose: () => void;
  tripLog: TTripLog | null;
  customFieldDefs: TripLogCustomFieldDef[];
  onEdit: () => void;
  onDeleted: () => void;
  /** Where a linked place opens. Absent, the places are listed and not openable. */
  onOpenPlace?: (placeId: string) => void;
  canManageMedia?: boolean;
  onMediaChanged?: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const toast = useToast();

  // Fetch the trip's media (with fresh presigned URLs) whenever the dialog opens.
  // The trip passed in may come from a list that doesn't include media.
  useEffect(() => {
    if (!open || !tripLog) return;
    const { id } = tripLog;
    setMediaLoading(true);
    getTripLog(id)
      .then((full) => setMedia(full.media ?? []))
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load trip files."));
      })
      .finally(() => setMediaLoading(false));
  }, [open, tripLog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleMediaDeleted(id: string) {
    setMedia((prev) => prev.filter((m) => m.id !== id));
    onMediaChanged?.();
  }

  async function handleDelete() {
    if (!tripLog) return;
    setDeleting(true);
    try {
      await deleteTripLog(tripLog.id);
      setConfirmingDelete(false);
      onDeleted();
      toast.success("Trip deleted.");
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't delete this trip. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  if (!tripLog) return null;

  const photoCount = media.filter((item) => mediaCategory(item.mediaType) !== "track").length;
  const trackCount = media.length - photoCount;
  const attributes = tripAttributeEntries(customFieldDefs, tripLog.customFields);

  return (
    <>
      <Dialog
        open={open}
        title={tripTitle(tripLog)}
        onClose={onClose}
        size="large"
        dismissible={!deleting}
        footer={
          <>
            <Button variant="danger" icon={Trash2} className={classes.delete} onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
            <Button variant="filled" icon={Pencil} onClick={onEdit}>
              Edit trip
            </Button>
          </>
        }
      >
        <div className={classes.content}>
          <div className={classes.summary}>
            <p className={classes.date}>{formatTripDate(tripLog.date)}</p>
            <div className={classes.pills}>
              {tripLog.types.length > 0 ? (
                tripLog.types.map((type) => (
                  <StatusPill key={type} label={tripTypeLabel(type)} icon={tripTypeLook(type).icon} />
                ))
              ) : (
                <StatusPill label="No type set" tone="muted" icon={tripTypeLook(null).icon} />
              )}
            </div>
          </div>

          <section className={classes.section}>
            <SectionHeader title="Places" count={tripLog.places.length || undefined} />
            {tripLog.places.length === 0 ? (
              <p className={classes.muted}>No places linked. Edit the trip to add one.</p>
            ) : (
              tripLog.places.map((place) => (
                <Row
                  key={place.id}
                  title={place.name}
                  leading={<IconTile icon={MapPin} hue="var(--theme-accent)" />}
                  onOpen={onOpenPlace ? () => onOpenPlace(place.id) : undefined}
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
            {tripLog.notes ? (
              <p className={classes.notes}>{tripLog.notes}</p>
            ) : (
              <p className={classes.muted}>No notes</p>
            )}
          </section>

          {attributes.length > 0 && (
            <section className={classes.section}>
              <SectionHeader title="Attributes" />
              <dl className={classes.attributes}>
                {attributes.map((entry) => (
                  <div key={entry.key} className={classes.attribute}>
                    <dt>{entry.label}</dt>
                    <dd>{formatAttribute(entry)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </Dialog>

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

export default TripLogViewDialog;
