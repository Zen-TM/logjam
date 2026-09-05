import { useState, useEffect, useMemo, useRef } from "react";
import {
  fieldValue,
  numericFieldValue,
  SOURCES_FIELD_KEY,
} from "@logjam/shared";
import { Pencil, TriangleAlert, X, Trash2 } from "lucide-react";
import classes from "./PlaceDetailPanel.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import PlaceDialog from "../../dialogs/PlaceDialog";
import ShareDialog from "../../dialogs/ShareDialog";
import TripLogDialog from "../../dialogs/TripLogDialog";
import TripLogViewDialog from "../../dialogs/TripLogViewDialog";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import RemoveSharedButton from "../../common/RemoveSharedButton";
import type { TPlace, TFriend, TTripLog, TPlaceShare } from "../../../placeUtils";
import { mediaCategory, type TripLogCustomFieldDef, type MediaItem } from "@logjam/shared";
import {
  formatCanyonGrade,
  deletePlace,
  deleteMedia,
  copyPlace,
  sharePlaceWith,
  unsharePlaceWith,
  getTripLogs,
  getPlaceDetail,
  getPlaceShares,
  isHttpUrl,
  ownerUsername,
} from "../../../placeUtils";
import PlaceSlideshow from "../../media/PlaceSlideshow";
import TrackIcon from "../../media/TrackIcon";

// Format a stored custom-field value for display. Returns null when the value
// is empty so the caller can skip rendering the row entirely.
function formatCustomFieldValue(
  value: unknown,
  type: TripLogCustomFieldDef["type"],
): string | null {
  if (value == null || value === "") return null;
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "date" && typeof value === "string") {
    // Date-typed custom fields are stored as UTC-midnight (date-only); format in
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

// Grammatical list: "a", "a and b", "a, b, and c".
function joinWithAnd(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** The place's source links, or none. Lived at `attributes.sources` before the
 *  rework; it is a reserved `_`-prefixed key in `fieldValues` now, which no
 *  user-authored key can collide with. */
function placeSources(place: { fieldValues?: unknown }): [string, string][] {
  const stored = fieldValue(place.fieldValues, SOURCES_FIELD_KEY);
  return Array.isArray(stored) ? (stored as [string, string][]) : [];
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
  customFieldDefs,
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
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
  placeCustomFieldDefs: TripLogCustomFieldDef[];
  onPlaceCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
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
  const [safetyDismissed, setSafetyDismissed] = useState(
    () => localStorage.getItem('logjam.safetyDismissed') === '1'
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [trackToDelete, setTrackToDelete] = useState<MediaItem | null>(null);
  const [deletingTrack, setDeletingTrack] = useState(false);

  const [tripLogs, setTripLogs] = useState<TTripLog[]>([]);
  const [placeMedia, setPlaceMedia] = useState<MediaItem[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [showTripLogDialog, setShowTripLogDialog] = useState(false);
  const [showTripLogView, setShowTripLogView] = useState(false);
  const [viewingTripLog, setViewingTripLog] = useState<TTripLog | null>(null);
  const [editingTripLog, setEditingTripLog] = useState<TTripLog | undefined>(undefined);

  const [copying, setCopying] = useState(false);
  const [placeShares, setPlaceShares] = useState<TPlaceShare[]>([]);

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
  useEffect(() => {
    if (!place || !isOwnedPlace) {
      sharesFetchKeyRef.current = null;
      setPlaceShares([]);
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

  useEffect(() => {
    if (!place) {
      detailFetchKeyRef.current = null;
      setTripLogs([]);
      setPlaceMedia([]);
      return;
    }
    if (detailFetchKeyRef.current === place.id) return;
    detailFetchKeyRef.current = place.id;
    const requestedId = place.id;
    setLoadingTrips(true);
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
    return <span className={classes.caption}>No place selected.</span>;
  }

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
    if (!place) return;
    setDeleting(true);
    try {
      await deletePlace(place.id);
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
      toast.error(messageFromError(err, "Couldn't delete place. Please try again."));
      setDeleting(false);
    }
  }

  async function handleCopyPlace(andRemove: boolean) {
    if (!place) return;
    setCopying(true);
    try {
      await copyPlace(place.id);
      if (andRemove) {
        await unsharePlaceWith(place.id, "me");
        onRefetchShared();
        setSelectedPlaceID(null);
      }
      onRefetch();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't copy place. Please try again."));
    } finally {
      setCopying(false);
    }
  }

  // Plain "remove my access" is RemoveSharedButton below — it owns the confirm
  // the whole app shares. This is only the copy-then-remove pairing, where the
  // user keeps a copy of their own and the confirm would be asking about a loss
  // that isn't happening.

  // Re-pull place-level media after the edit dialog uploads/deletes, so the
  // slideshow + track card reflect changes without waiting for a Save.
  function reloadPlaceMedia() {
    if (!place) return;
    const requestedId = place.id;
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
      toast.error(messageFromError(err, "Couldn't delete track. Please try again."));
    } finally {
      setDeletingTrack(false);
    }
  }

  const canyonGrade = formatCanyonGrade(place);
  const visualMedia = placeMedia.filter(
    (m) => mediaCategory(m.mediaType) !== "track",
  );
  const track = placeMedia.find((m) => mediaCategory(m.mediaType) === "track") ?? null;
  const showMediaTop = visualMedia.length > 0 || track != null || isOwnedPlace;

  return (
    <>
      <div className={classes.root}>
        <div className={classes.scrollArea}>
          {visualMedia.length > 0 && <PlaceSlideshow media={visualMedia} />}

          {track && (
            <div className={classes.trackSection}>
              <div className={classes.sectionLabel}>Track</div>
              <div className={classes.trackCard}>
                <a
                  className={classes.trackCardLink}
                  href={track.displayUrl}
                  download={track.filename}
                >
                  <TrackIcon color={track.color} size={18} />
                  <span className={classes.trackCardName}>{track.filename}</span>
                </a>
                {isOwnedPlace && (
                  <button
                    className={classes.trackDeleteBtn}
                    onClick={() => setTrackToDelete(track)}
                    aria-label={`Delete track ${track.filename}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          )}

          {isOwnedPlace && (
            <button className={classes.uploadBtn} onClick={() => setShowEdit(true)}>
              Upload media
            </button>
          )}

          {showMediaTop && <div className={classes.divider} />}

          {!safetyDismissed && (
            <div className={classes.safetyWarning} role="note">
              <TriangleAlert size={16} className={classes.safetyIcon} />
              <span className={classes.safetyText}>
                Data is user-generated and may be inaccurate or outdated. Not a
                substitute for your own navigation, judgement, or rescue planning.
              </span>
              <button
                type="button"
                className={classes.safetyDismiss}
                aria-label="Dismiss safety warning"
                onClick={() => {
                  localStorage.setItem('logjam.safetyDismissed', '1');
                  setSafetyDismissed(true);
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {(place.ropeWikiId != null ||
            place.altNames.length > 0 ||
            sharedWithNode != null) && (
            <div className={classes.headerMeta}>
              {place.ropeWikiId != null && (
                <p className={classes.disclaimer}>
                  Place data imported from RopeWiki (facts only; descriptions not
                  imported), &copy; RopeWiki contributors, licensed{" "}
                  <a
                    href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    CC BY-NC-SA 4.0
                  </a>
                  .
                </p>
              )}
              {place.altNames.length > 0 && (
                <p className={classes.altNames}>Also known as: {place.altNames.join(", ")}</p>
              )}
              {sharedWithNode != null && (
                <p className={classes.altNames}>Shared with: {sharedWithNode}</p>
              )}
            </div>
          )}

          <div
            className={classes.attributesBox}
            role="button"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) return;
              setShowEdit(true);
            }}
            tabIndex={0}
            onKeyDown={(e) => {
              // FEUI-009: mirrors the onClick guard above — keydown bubbles
              // from a focused nested source <a> or the edit <button>, so an
              // unguarded Enter/Space here both activates that element AND
              // pops the edit dialog over it.
              if ((e.target as HTMLElement).closest("a, button")) return;
              if (e.key === "Enter" || e.key === " ") setShowEdit(true);
            }}
            aria-label="Place attributes — click to edit"
          >
            <button
              className={classes.editIcon}
              onClick={(e) => {
                e.stopPropagation();
                setShowEdit(true);
              }}
              aria-label="Edit place"
            >
              <Pencil size={14} />
            </button>
            {canyonGrade && (
              <p>
                <b>Grade:</b> {canyonGrade}
              </p>
            )}
            <p>
              <b>Location:</b> {place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}
            </p>
            {/* The four remaining canyon scalars, read from fieldValues under
                their reserved keys. Still hardcoded rather than rendered from
                the type's definitions — see the ponytail note in PlaceDialog:
                the generic field form is phase 6, with the rest of the web UI.
                A place of a type that has no grades simply renders none of
                these, with no special case. */}
            {numericFieldValue(place.fieldValues, "quality") != null && (
              <p>
                <b>Quality:</b> {numericFieldValue(place.fieldValues, "quality")}/5
              </p>
            )}
            {numericFieldValue(place.fieldValues, "num_abseils") != null && (
              <p>
                <b>Pitches:</b> {numericFieldValue(place.fieldValues, "num_abseils")}
              </p>
            )}
            {numericFieldValue(place.fieldValues, "longest_abseil") != null && (
              <p>
                <b>Longest Pitch:</b>{" "}
                {numericFieldValue(place.fieldValues, "longest_abseil")}m
              </p>
            )}
            {numericFieldValue(place.fieldValues, "hours") != null && (
              <p>
                <b>Hours:</b> {numericFieldValue(place.fieldValues, "hours")}
              </p>
            )}
            {placeSources(place).length > 0 && (
              <div>
                <b>Sources:</b>
                <ul className={classes.sourcesList}>
                  {placeSources(place).map(([label, url], i) => (
                    <li key={i}>
                      {/* FEUI-012: only render http(s) as a link — a non-http
                          scheme (e.g. from data saved before the save-time
                          check existed) falls back to plain text. */}
                      {url && isHttpUrl(url) ? (
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {label}
                        </a>
                      ) : (
                        label
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {placeCustomFieldDefs.map((def) => {
              const display = formatCustomFieldValue(
                fieldValue(place.fieldValues, def.key),
                def.type,
              );
              if (display == null) return null;
              return (
                <p key={def.key}>
                  <b>{def.label}:</b> {display}
                </p>
              );
            })}
            {place.notes && place.notes.trim().length > 0 && (
              <div className={classes.notesBlock}>
                <b>Notes:</b>
                <p className={classes.notesText}>{place.notes}</p>
              </div>
            )}
          </div>

          <div className={classes.tripLogsRegion}>
            <div className={classes.tripLogsHeader}>
              Trip Logs {tripLogs.length > 0 && `(${tripLogs.length})`}
            </div>
            {loadingTrips ? (
              <span className={classes.caption}>Loading...</span>
            ) : tripLogs.length === 0 ? (
              <span className={classes.caption}>
                {isOwnedPlace
                  ? "No trips logged yet."
                  : "Trip logs are private to the place owner."}
              </span>
            ) : (
              <div className={classes.tripLogList}>
                {tripLogs.map((trip) => (
                  <button
                    key={trip.id}
                    className={classes.tripLogCard}
                    onClick={() => {
                      setViewingTripLog(trip);
                      setShowTripLogView(true);
                    }}
                  >
                    <span className={classes.tripLogDate}>
                      {new Date(trip.date).toLocaleDateString("en-AU", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        // Trip dates are stored as UTC-midnight (date-only); format
                        // in UTC so AEST (UTC+10/+11) doesn't render the prior day.
                        timeZone: "UTC",
                      })}
                    </span>
                    {trip.notes && (
                      <span className={classes.tripLogNotes}>
                        {trip.notes.length > 60
                          ? trip.notes.slice(0, 60) + "…"
                          : trip.notes}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={classes.footer}>
          <div className={classes.divider} />
          {isOwnedPlace ? (
            <>
              <div className={classes.footerRow}>
                <button
                  className={classes.ghostBtn}
                  onClick={() => setShowShareDialog(true)}
                >
                  Share
                </button>
                <button
                  className={classes.ghostBtn}
                  onClick={() => {
                    setEditingTripLog(undefined);
                    setShowTripLogDialog(true);
                  }}
                >
                  Log Trip
                </button>
              </div>
              <button
                className={classes.dangerBtn}
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <div className={classes.footerRow}>
                <button
                  className={classes.ghostBtn}
                  title="Copy to My Places"
                  onClick={() => handleCopyPlace(false)}
                  disabled={copying}
                >
                  Copy
                </button>
                {/* Same control, same confirm, as every other shared thing in
                    the app — this surface used to revoke on a single click
                    with no confirmation at all. */}
                <RemoveSharedButton
                  kindLabel="place"
                  itemName={place.name}
                  ownerName={ownerUsername(friends, place.ownerId)}
                  className={classes.ghostBtn}
                  disabled={copying}
                  remove={() => unsharePlaceWith(place.id, "me")}
                  onRemoved={() => {
                    onRefetchShared();
                    setSelectedPlaceID(null);
                  }}
                >
                  Remove
                </RemoveSharedButton>
              </div>
              <button
                className={classes.ghostBtnFull}
                title="Copy to My Places, then remove the share"
                onClick={() => handleCopyPlace(true)}
                disabled={copying}
              >
                Copy and Remove
              </button>
            </>
          )}
        </div>
      </div>

      <PlaceDialog
        place={place}
        open={showEdit && !pickingCoords}
        onClose={() => setShowEdit(false)}
        onSaved={onRefetch}
        onPickCoords={onPickCoords}
        onCancelPickCoords={onCancelPickCoords}
        customFieldDefs={placeCustomFieldDefs}
        onCustomFieldDefsChange={onPlaceCustomFieldDefsChange}
        onMediaChanged={reloadPlaceMedia}
      />

      <ConfirmDialog
        open={trackToDelete != null}
        title="Delete track?"
        message={
          <>
            This permanently deletes the track <b>{trackToDelete?.filename}</b>. This
            cannot be undone.
          </>
        }
        busy={deletingTrack}
        onConfirm={handleDeleteTrack}
        onClose={() => setTrackToDelete(null)}
      />

      {isOwnedPlace && (
        <ShareDialog
          title={`Share ${place.name}`}
          blurb={
            <>
              Recipients see this place&rsquo;s details, place-level notes and
              place-level media, and can copy or export it while the share is
              active. They do <b>not</b> see your trip logs or any per-trip notes
              or media. Unsharing won&rsquo;t remove copies they&rsquo;ve already
              made.
            </>
          }
          friends={friends}
          open={showShareDialog}
          onClose={() => setShowShareDialog(false)}
          listShares={() => getPlaceShares(place.id)}
          share={(userId) => sharePlaceWith(place.id, userId)}
          unshare={(userId) => unsharePlaceWith(place.id, userId)}
        />
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Place"
        message={
          <>
            Are you sure you want to delete {place.name}? Its photos, tracks, and
            shares are permanently deleted. Your trip logs are kept — they&rsquo;ll
            be unlinked from this place but stay in your logbook. This cannot be
            undone.
          </>
        }
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
          getTripLogs(place.id)
            .then(setTripLogs)
            .catch((err) => {
              console.error(err);
              toast.error(messageFromError(err, "Couldn't refresh trip logs."));
            });
          // Also refresh the global Trip Logs list/search (separate query).
          onRefetchTripLogs();
        }}
        places={places}
        defaultPlaceId={place.id}
        tripLog={editingTripLog}
        customFieldDefs={customFieldDefs}
        onCustomFieldDefsChange={onCustomFieldDefsChange}
        existingTripTypes={existingTripTypes}
      />

      <TripLogViewDialog
        open={showTripLogView}
        onClose={() => {
          setShowTripLogView(false);
          setViewingTripLog(null);
        }}
        tripLog={viewingTripLog}
        customFieldDefs={customFieldDefs}
        canManageMedia={isOwnedPlace}
        onMediaChanged={onQuotaChanged}
        onEdit={() => {
          setShowTripLogView(false);
          setEditingTripLog(viewingTripLog ?? undefined);
          setViewingTripLog(null);
          setShowTripLogDialog(true);
        }}
        onDeleted={() => {
          getTripLogs(place.id)
            .then(setTripLogs)
            .catch((err) => {
              console.error(err);
              toast.error(messageFromError(err, "Couldn't refresh trip logs."));
            });
          onQuotaChanged();
          // Also refresh the global Trip Logs list/search (separate query).
          onRefetchTripLogs();
        }}
      />
    </>
  );
}

export default PlaceDetailPanel;
