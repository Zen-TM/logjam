import { useState, useEffect } from "react";
import { Check, MapPin, Minus, Plus, Trash2, Users } from "lucide-react";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import type { TPlace, TFriend } from "../../placeUtils";
import { bulkDeletePlaces, sharePlaceWith } from "../../placeUtils";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import type { TExportFormat } from "../../placeExport";
import { buildPlaceExport } from "../../placeExport";
import ConfirmDialog from "./ConfirmDialog";
import {
  Avatar,
  Button,
  Dialog,
  IconButton,
  IconTile,
  Row,
  SearchField,
  SectionHeader,
  Select,
} from "../../ui";
import classes from "./SelectedPlacesDialog.module.css";

const EXPORT_FORMATS: { value: TExportFormat; label: string }[] = [
  { value: "gpx", label: "GPX" },
  { value: "kml", label: "KML" },
  { value: "geojson", label: "GeoJSON" },
  { value: "csv", label: "CSV" },
];

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * What to do with the places just picked: take them out as a file, hand them
 * to a friend, or delete the ones that are yours.
 *
 * THE SELECTION IS EDITABLE HERE, because the list behind it is filtered and a
 * place remembered mid-task may not be on screen any more — so the dialog
 * carries its own search for adding one and a minus on every row for dropping
 * one, rather than making the user close it and start the selection again.
 *
 * Sharing and deleting are OWNER-ONLY and say so with a count rather than by
 * disappearing: a selection of someone else's places is a normal thing to have
 * made, and a section that vanished would read as the dialog being broken.
 */
function SelectedPlacesDialog({
  open,
  selectedPlaces,
  placeCustomFieldDefs,
  availablePlaces,
  ownedPlaceIds,
  friends,
  onClose,
  onDeleted,
  onQuotaChanged,
  onRemovePlace,
  onAddPlace,
}: {
  open: boolean;
  selectedPlaces: TPlace[];
  /** Labels the field values in the human-readable GPX/KML descriptions. The
   *  machine-readable forms key by `key` so they round-trip through import. */
  placeCustomFieldDefs: TripLogCustomFieldDef[];
  availablePlaces: TPlace[];
  ownedPlaceIds: Set<string>;
  friends: TFriend[];
  onClose: () => void;
  onDeleted: () => void;
  onQuotaChanged?: () => void;
  onRemovePlace: (id: string) => void;
  onAddPlace: (id: string) => void;
}) {
  const [shareSearch, setShareSearch] = useState("");
  const [shareFriendIds, setShareFriendIds] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exportFormat, setExportFormat] = useState<TExportFormat>("gpx");
  const [placeSearch, setPlaceSearch] = useState("");
  const toast = useToast();

  useEffect(() => {
    if (!open) {
      setPlaceSearch("");
      setShareSearch("");
      setShareFriendIds([]);
    }
  }, [open]);

  const busy = sharing || deleting;
  const ownedPlaces = selectedPlaces.filter((place) => ownedPlaceIds.has(place.id));
  const sharedCount = selectedPlaces.length - ownedPlaces.length;

  const selectedIds = new Set(selectedPlaces.map((place) => place.id));
  const placeSearchResults =
    placeSearch.trim().length >= 3
      ? availablePlaces
          .filter(
            (place) =>
              !selectedIds.has(place.id) &&
              [place.name, ...place.altNames].some((name) =>
                name.toLowerCase().includes(placeSearch.trim().toLowerCase()),
              ),
          )
          .slice(0, 6)
      : [];

  const friendMatches = friends.filter(
    (friend) =>
      !shareFriendIds.includes(friend.id) &&
      friend.username.toLowerCase().includes(shareSearch.trim().toLowerCase()),
  );

  async function handleShare() {
    if (shareFriendIds.length === 0 || ownedPlaces.length === 0) return;
    setSharing(true);
    try {
      for (const place of ownedPlaces) {
        for (const friendId of shareFriendIds) {
          try {
            await sharePlaceWith(place.id, friendId);
          } catch (err) {
            console.error(err);
            toast.error(messageFromError(err, "Couldn't share one or more places."));
          }
        }
      }
      setShareFriendIds([]);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't share places. Please try again."));
    } finally {
      setSharing(false);
    }
  }

  function handleExport() {
    const { blob, filename } = buildPlaceExport(
      selectedPlaces,
      exportFormat,
      placeCustomFieldDefs,
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await bulkDeletePlaces(ownedPlaces.map((place) => place.id));
      setShowDeleteConfirm(false);
      onQuotaChanged?.();
      onDeleted();
      onClose();
      toast.success(`Deleted ${plural(ownedPlaces.length, "place")}.`);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't delete places. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog
        open={open && !showDeleteConfirm}
        title={plural(selectedPlaces.length, "place")}
        size="large"
        dismissible={!busy}
        onClose={onClose}
        footer={
          <>
            {ownedPlaces.length > 0 && (
              <Button
                variant="danger"
                icon={Trash2}
                className={classes.deleteVerb}
                disabled={busy}
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete {plural(ownedPlaces.length, "place")}
              </Button>
            )}
            <Button onClick={onClose} disabled={busy}>
              Close
            </Button>
          </>
        }
      >
        <div className={classes.body}>
          <section className={classes.group}>
            <SectionHeader
              title="These places"
              count={selectedPlaces.length}
            />
            {sharedCount > 0 && (
              <p className={classes.note}>
                {plural(sharedCount, "place")} shared with you — those can be exported,
                not shared on or deleted.
              </p>
            )}
            {selectedPlaces.map((place) => (
              <Row
                key={place.id}
                leading={
                  <IconTile
                    icon={MapPin}
                    hue={
                      ownedPlaceIds.has(place.id)
                        ? "var(--theme-accent)"
                        : "var(--hue-shared)"
                    }
                  />
                }
                title={place.name}
                subtitle={ownedPlaceIds.has(place.id) ? undefined : "Shared with you"}
                trailing={
                  <IconButton
                    icon={Minus}
                    label={`Take ${place.name} out of the selection`}
                    onClick={() => onRemovePlace(place.id)}
                  />
                }
              />
            ))}

            <SearchField
              label="Add another place"
              placeholder="Search your places"
              value={placeSearch}
              onChange={(event) => setPlaceSearch(event.target.value)}
              onKeyDown={(event) => {
                // Enter takes the obvious one: the only match.
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (placeSearchResults.length === 1) {
                  onAddPlace(placeSearchResults[0].id);
                  setPlaceSearch("");
                }
              }}
            />
            {placeSearchResults.map((place) => (
              <Row
                key={place.id}
                leading={<IconTile icon={Plus} hue="var(--theme-bonus-1)" />}
                title={place.name}
                subtitle={place.altNames.length > 0 ? place.altNames.join(", ") : undefined}
                description="Press to add it to the selection"
                onOpen={() => {
                  onAddPlace(place.id);
                  setPlaceSearch("");
                }}
              />
            ))}
          </section>

          <section className={classes.group}>
            <SectionHeader title="Export" />
            <div className={classes.exportRow}>
              <Select
                label="Format"
                className={classes.format}
                value={exportFormat}
                onChange={(event) => setExportFormat(event.target.value as TExportFormat)}
              >
                {EXPORT_FORMATS.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label}
                  </option>
                ))}
              </Select>
              <Button variant="outline" onClick={handleExport} disabled={busy}>
                Download
              </Button>
            </div>
          </section>

          <section className={classes.group}>
            <SectionHeader title="Share" />
            {ownedPlaces.length === 0 ? (
              <p className={classes.note}>
                Sharing is for your own places, and none of these are yours.
              </p>
            ) : friends.length === 0 ? (
              <p className={classes.note}>
                Sharing is between friends. Add one on the Friends page, then come back.
              </p>
            ) : (
              <>
                {/* What the press will do, before the press. */}
                <p className={classes.note}>
                  {sharedCount > 0
                    ? `Your ${plural(ownedPlaces.length, "place")} of these. `
                    : ""}
                  Recipients can copy or export them while the share is active.
                  Unsharing won&rsquo;t remove copies they&rsquo;ve already made.
                </p>
                {shareFriendIds.length > 0 && (
                  <>
                    {shareFriendIds.map((id) => {
                      const friend = friends.find((row) => row.id === id);
                      if (!friend) return null;
                      return (
                        <Row
                          key={id}
                          leading={<Avatar username={friend.username} />}
                          title={friend.username}
                          trailing={
                            <IconButton
                              icon={Minus}
                              label={`Don't share with ${friend.username}`}
                              disabled={busy}
                              onClick={() =>
                                setShareFriendIds(shareFriendIds.filter((other) => other !== id))
                              }
                            />
                          }
                        />
                      );
                    })}
                  </>
                )}
                <SearchField
                  label="Search friends"
                  placeholder="Search friends"
                  value={shareSearch}
                  onChange={(event) => setShareSearch(event.target.value)}
                />
                {friendMatches.length === 0 ? (
                  <p className={classes.note}>
                    {shareSearch.trim()
                      ? `No friends match “${shareSearch.trim()}”.`
                      : "Everyone you know is already on the list."}
                  </p>
                ) : (
                  friendMatches.map((friend) => (
                    <Row
                      key={friend.id}
                      leading={<Avatar username={friend.username} />}
                      title={friend.username}
                      description="Press to add them"
                      disabled={busy}
                      onOpen={() => {
                        setShareFriendIds([...shareFriendIds, friend.id]);
                        setShareSearch("");
                      }}
                      trailing={
                        <span className={classes.addMark} data-mark aria-hidden>
                          <Plus size={16} />
                        </span>
                      }
                    />
                  ))
                )}
                <Button
                  variant="filled"
                  icon={Check}
                  className={classes.shareVerb}
                  busy={sharing}
                  disabled={busy || shareFriendIds.length === 0}
                  onClick={handleShare}
                >
                  {shareFriendIds.length === 0
                    ? "Share"
                    : `Share with ${plural(shareFriendIds.length, "friend")}`}
                </Button>
              </>
            )}
          </section>

          {friends.length === 0 && ownedPlaces.length > 0 && (
            <p className={classes.note} role="note">
              <Users size={14} aria-hidden /> Sharing needs a friend.
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete ${plural(ownedPlaces.length, "place")}?`}
        message={
          <>
            This permanently deletes {plural(ownedPlaces.length, "place")}, along with
            their photos, tracks and shares. Your trip logs are kept — they&rsquo;ll be
            unlinked from these places but stay in your logbook. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        confirmColor="error"
        busy={deleting}
        onConfirm={handleDelete}
        onClose={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}

export default SelectedPlacesDialog;
