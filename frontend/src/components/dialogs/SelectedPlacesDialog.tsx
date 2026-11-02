import { useState } from "react";
import {
  friendMatches,
  noFriendsMatch,
  noFriendsMessage,
  sharePromise,
  type TripLogCustomFieldDef,
} from "@logjam/shared";
import type { TPlace, TFriend } from "../../placeUtils";
import { bulkSharePlaces } from "../../placeUtils";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import type { TExportFormat } from "../../placeExport";
import { buildPlaceExport } from "../../placeExport";
import {
  Avatar,
  Button,
  Dialog,
  ErrorBanner,
  IconButton,
  IconTile,
  Row,
  SearchField,
  SectionHeader,
  Select,
  Icon,
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
 * Take the places just picked out as a file, or hand them to friends. One verb
 * per opening: a dialog that offered both, and Delete, had no name for what it
 * was doing. Giving ONE place to a friend is `ShareDialog`, which also lists
 * who has it; this is the many-places form, so it ticks friends and then sends.
 *
 * THE SELECTION IS EDITABLE HERE, because the list behind it is filtered and a
 * place remembered mid-task may not be on screen any more — so the dialog
 * carries its own search for adding one and a minus on every row for dropping
 * one, rather than making the user close it and start the selection again.
 *
 * Sharing is OWNER-ONLY and says so with a count rather than by disappearing:
 * a selection of someone else's places is a normal thing to have made, and a
 * section that vanished would read as the dialog being broken.
 */
function SelectedPlacesDialog({
  open,
  mode,
  selectedPlaces,
  placeCustomFieldDefs,
  availablePlaces,
  ownedPlaceIds,
  friends,
  onClose,
  onRemovePlace,
  onAddPlace,
}: {
  open: boolean;
  mode: "share" | "export";
  selectedPlaces: TPlace[];
  /** Labels the field values in the human-readable GPX/KML descriptions. The
   *  machine-readable forms key by `key` so they round-trip through import. */
  placeCustomFieldDefs: TripLogCustomFieldDef[];
  availablePlaces: TPlace[];
  ownedPlaceIds: Set<string>;
  friends: TFriend[];
  onClose: () => void;
  onRemovePlace: (id: string) => void;
  onAddPlace: (id: string) => void;
}) {
  const [shareSearch, setShareSearch] = useState("");
  const [shareFriendIds, setShareFriendIds] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<TExportFormat>("gpx");
  const [placeSearch, setPlaceSearch] = useState("");
  const toast = useToast();

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setPlaceSearch("");
      setShareSearch("");
      setShareFriendIds([]);
      setShareError(null);
    }
  }

  const busy = sharing;
  const ownedPlaces = selectedPlaces.filter((place) =>
    ownedPlaceIds.has(place.id),
  );
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

  const matchingFriends = friends.filter(
    (friend) =>
      !shareFriendIds.includes(friend.id) &&
      friendMatches(friend.username, shareSearch),
  );

  async function handleShare() {
    if (ownedPlaces.length === 0 || shareFriendIds.length === 0) return;
    setSharing(true);
    setShareError(null);
    try {
      const result = await bulkSharePlaces(
        ownedPlaces.map((place) => place.id),
        shareFriendIds,
      );
      onClose();
      toast.done(
        result.granted > 0
          ? `Shared ${plural(ownedPlaces.length, "place")} with ${plural(shareFriendIds.length, "friend")}.`
          : "They already have these.",
      );
    } catch (err) {
      // The dialog stays open with the picks intact, so a retry is one press.
      console.error(err);
      setShareError(
        messageFromError(err, "Couldn't share places. Please try again."),
      );
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

  return (
    <Dialog
      open={open}
      title={`${mode === "share" ? "Share" : "Export"} ${plural(selectedPlaces.length, "place")}`}
      size="large"
      dismissible={!busy}
      onClose={onClose}
      footer={
        <Button onClick={onClose} disabled={busy} disabledReason="Working…">
          Close
        </Button>
      }
    >
      <div className={classes.body}>
        <section className={classes.group}>
          <SectionHeader title="These places" count={selectedPlaces.length} />
          {mode === "share" && sharedCount > 0 && (
            <p className={classes.note}>
              {plural(sharedCount, "place")} shared with you can&rsquo;t be
              shared on.
            </p>
          )}
          {selectedPlaces.map((place) => (
            <Row
              key={place.id}
              leading={
                <IconTile
                  icon="place"
                  hue={
                    ownedPlaceIds.has(place.id)
                      ? "var(--color-accent)"
                      : "var(--hue-shared)"
                  }
                />
              }
              title={place.name}
              subtitle={
                ownedPlaceIds.has(place.id) ? undefined : "Shared with you"
              }
              trailing={
                <IconButton
                  icon="remove"
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
              leading={<IconTile icon="add" hue="var(--color-neutral)" />}
              title={place.name}
              subtitle={
                place.altNames.length > 0
                  ? place.altNames.join(", ")
                  : undefined
              }
              description="Press to add it to the selection"
              onOpen={() => {
                onAddPlace(place.id);
                setPlaceSearch("");
              }}
            />
          ))}
        </section>

        {mode === "export" && (
          <section className={classes.group}>
            <SectionHeader title="Export" />
            <div className={classes.exportRow}>
              <Select
                label="Format"
                className={classes.format}
                value={exportFormat}
                onChange={(event) =>
                  setExportFormat(event.target.value as TExportFormat)
                }
              >
                {EXPORT_FORMATS.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={busy}
                disabledReason="Working…"
              >
                Download
              </Button>
            </div>
          </section>
        )}

        {mode === "share" && (
          <section className={classes.group}>
            <SectionHeader title="Share with" />
            {ownedPlaces.length === 0 ? (
              <p className={classes.note}>
                Sharing is for your own places, and none of these are yours.
              </p>
            ) : friends.length === 0 ? (
              <p className={classes.note}>{noFriendsMessage("share").body}</p>
            ) : (
              <>
                {/* What the press will do, before the press. */}
                <p className={classes.note}>{sharePromise("selection")}</p>
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
                              icon="unshare"
                              label={`Don't share with ${friend.username}`}
                              disabled={busy}
                              disabledReason="Working…"
                              onClick={() =>
                                setShareFriendIds(
                                  shareFriendIds.filter(
                                    (other) => other !== id,
                                  ),
                                )
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
                {matchingFriends.length === 0 ? (
                  <p className={classes.note}>
                    {shareSearch.trim()
                      ? noFriendsMatch(shareSearch)
                      : "Everyone you know is ticked."}
                  </p>
                ) : (
                  matchingFriends.map((friend) => (
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
                          <Icon idea="add" size={16} />
                        </span>
                      }
                    />
                  ))
                )}
                {shareError && <ErrorBanner message={shareError} />}
                <Button
                  variant="filled"
                  icon="done"
                  className={classes.shareVerb}
                  busy={sharing}
                  disabled={busy || shareFriendIds.length === 0}
                  disabledReason={
                    sharing ? "Working…" : "Pick a friend to share with"
                  }
                  onClick={handleShare}
                >
                  {shareFriendIds.length === 0
                    ? "Share"
                    : `Share with ${plural(shareFriendIds.length, "friend")}`}
                </Button>
              </>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}

export default SelectedPlacesDialog;
