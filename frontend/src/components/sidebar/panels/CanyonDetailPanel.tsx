import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from "@mui/material";
import { Pencil, TriangleAlert, X, Trash2 } from "lucide-react";
import classes from "./CanyonDetailPanel.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import CanyonDialog from "../../dialogs/CanyonDialog";
import ShareCanyonDialog from "../../dialogs/ShareCanyonDialog";
import TripLogDialog from "../../dialogs/TripLogDialog";
import TripLogViewDialog from "../../dialogs/TripLogViewDialog";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import type { TCanyon, TFriend, TTripLog, TCanyonShare } from "../../../canyonUtils";
import { mediaCategory, type TripLogCustomFieldDef, type MediaItem } from "@logjam/shared";
import {
  formatCanyonGrade,
  deleteCanyon,
  deleteMedia,
  copyCanyon,
  unshareCanyonWith,
  getTripLogs,
  getCanyonDetail,
  getCanyonShares,
} from "../../../canyonUtils";
import CanyonSlideshow from "../../media/CanyonSlideshow";
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

function CanyonDetailPanel({
  canyon,
  canyons,
  isOwnedCanyon,
  friends,
  onRefetch,
  onRefetchShared,
  setSelectedCanyonID,
  onPickCoords,
  pickingCoords,
  onCancelPickCoords,
  customFieldDefs,
  onCustomFieldDefsChange,
  canyonCustomFieldDefs,
  onCanyonCustomFieldDefsChange,
  onQuotaChanged,
  onRefetchTripLogs,
}: {
  canyon: TCanyon | undefined;
  canyons: TCanyon[];
  isOwnedCanyon: boolean;
  friends: TFriend[];
  onRefetch: () => void;
  onRefetchShared: () => void;
  setSelectedCanyonID: (id: string | null) => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  pickingCoords: boolean;
  onCancelPickCoords: () => void;
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
  canyonCustomFieldDefs: TripLogCustomFieldDef[];
  onCanyonCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
  onQuotaChanged: () => void;
  // Retrigger the global Trip Logs list/search after a trip is created or
  // deleted here — the canyon-scoped refetch below only updates this panel.
  onRefetchTripLogs: () => void;
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
  const [canyonMedia, setCanyonMedia] = useState<MediaItem[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [showTripLogDialog, setShowTripLogDialog] = useState(false);
  const [showTripLogView, setShowTripLogView] = useState(false);
  const [viewingTripLog, setViewingTripLog] = useState<TTripLog | null>(null);
  const [editingTripLog, setEditingTripLog] = useState<TTripLog | undefined>(undefined);

  const [copying, setCopying] = useState(false);
  const [canyonShares, setCanyonShares] = useState<TCanyonShare[]>([]);

  // Type suggestions for the trip dialog, flattened from this canyon's own
  // trips (the only trip list this panel loads).
  const existingTripTypes = useMemo(
    () => tripLogs.flatMap((t) => t.types),
    [tripLogs],
  );

  // Owner-only "shared with" list. Refetches when the share dialog closes so a
  // just-made share/unshare reflects immediately.
  useEffect(() => {
    if (!canyon || !isOwnedCanyon) {
      setCanyonShares([]);
      return;
    }
    getCanyonShares(canyon.id)
      .then(setCanyonShares)
      // Best-effort: this line is informational; on failure just omit it.
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canyon?.id, isOwnedCanyon, showShareDialog]);

  useEffect(() => {
    if (!canyon) {
      setTripLogs([]);
      setCanyonMedia([]);
      return;
    }
    setLoadingTrips(true);
    // One fetch yields canyon-level media plus (for owners) the trip logs.
    getCanyonDetail(canyon.id)
      .then((detail) => {
        setTripLogs(detail.tripLogs ?? []);
        setCanyonMedia(detail.media);
      })
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load canyon details."));
      })
      .finally(() => setLoadingTrips(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canyon?.id, toast]);

  if (!canyon) {
    return <span className={classes.caption}>No canyon selected.</span>;
  }

  // Owner-only "shared with" line: list up to 3 names, else 2 + "N more" link.
  const sharedNames = canyonShares.map((s) => s.sharedWith.username);
  const sharedWithNode =
    isOwnedCanyon && sharedNames.length > 0 ? (
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
    if (!canyon) return;
    setDeleting(true);
    try {
      await deleteCanyon(canyon.id);
      setShowDeleteConfirm(false);
      setDeleting(false);
      setSelectedCanyonID(null);
      onRefetch();
      onQuotaChanged();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't delete canyon. Please try again."));
      setDeleting(false);
    }
  }

  async function handleCopyCanyon(andRemove: boolean) {
    if (!canyon) return;
    setCopying(true);
    try {
      await copyCanyon(canyon.id);
      if (andRemove) {
        await unshareCanyonWith(canyon.id, "me");
        onRefetchShared();
        setSelectedCanyonID(null);
      }
      onRefetch();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't copy canyon. Please try again."));
    } finally {
      setCopying(false);
    }
  }

  async function handleRemoveShared() {
    if (!canyon) return;
    setCopying(true);
    try {
      await unshareCanyonWith(canyon.id, "me");
      onRefetchShared();
      setSelectedCanyonID(null);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't remove shared canyon. Please try again."));
    } finally {
      setCopying(false);
    }
  }

  // Re-pull canyon-level media after the edit dialog uploads/deletes, so the
  // slideshow + track card reflect changes without waiting for a Save.
  function reloadCanyonMedia() {
    if (!canyon) return;
    getCanyonDetail(canyon.id)
      .then((detail) => setCanyonMedia(detail.media))
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
      setCanyonMedia((prev) => prev.filter((m) => m.id !== trackToDelete.id));
      setTrackToDelete(null);
      onQuotaChanged();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't delete track. Please try again."));
    } finally {
      setDeletingTrack(false);
    }
  }

  const canyonGrade = formatCanyonGrade(canyon);
  const visualMedia = canyonMedia.filter(
    (m) => mediaCategory(m.mediaType) !== "track",
  );
  const track = canyonMedia.find((m) => mediaCategory(m.mediaType) === "track") ?? null;
  const showMediaTop = visualMedia.length > 0 || track != null || isOwnedCanyon;

  return (
    <>
      <div className={classes.root}>
        {visualMedia.length > 0 && <CanyonSlideshow media={visualMedia} />}

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
              {isOwnedCanyon && (
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

        {isOwnedCanyon && (
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
        {(canyon.ropeWikiId != null ||
          canyon.altNames.length > 0 ||
          sharedWithNode != null) && (
          <div className={classes.headerMeta}>
            {canyon.ropeWikiId != null && (
              <p className={classes.disclaimer}>
                Canyon data imported from RopeWiki (facts only; descriptions not
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
            {canyon.altNames.length > 0 && (
              <p className={classes.altNames}>Also known as: {canyon.altNames.join(", ")}</p>
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
            if (e.key === "Enter" || e.key === " ") setShowEdit(true);
          }}
          aria-label="Canyon attributes — click to edit"
        >
          <button
            className={classes.editIcon}
            onClick={(e) => {
              e.stopPropagation();
              setShowEdit(true);
            }}
            aria-label="Edit canyon"
          >
            <Pencil size={14} />
          </button>
          {canyonGrade && (
            <p>
              <b>Grade:</b> {canyonGrade}
            </p>
          )}
          <p>
            <b>Location:</b> {canyon.latitude.toFixed(4)}, {canyon.longitude.toFixed(4)}
          </p>
          {canyon.quality != null && (
            <p>
              <b>Quality:</b> {canyon.quality}/5
            </p>
          )}
          {canyon.numAbseils != null && (
            <p>
              <b>Pitches:</b> {canyon.numAbseils}
            </p>
          )}
          {canyon.longestAbseil != null && (
            <p>
              <b>Longest Pitch:</b> {canyon.longestAbseil}m
            </p>
          )}
          {canyon.hours != null && (
            <p>
              <b>Hours:</b> {canyon.hours}
            </p>
          )}
          {canyon.attributes.sources && canyon.attributes.sources.length > 0 && (
            <div>
              <b>Sources:</b>
              <ul className={classes.sourcesList}>
                {canyon.attributes.sources.map(([label, url], i) => (
                  <li key={i}>
                    {url ? (
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
          {canyonCustomFieldDefs.map((def) => {
            const display = formatCustomFieldValue(
              canyon.attributes.customFields?.[def.key],
              def.type,
            );
            if (display == null) return null;
            return (
              <p key={def.key}>
                <b>{def.label}:</b> {display}
              </p>
            );
          })}
          {canyon.notes && canyon.notes.trim().length > 0 && (
            <div className={classes.notesBlock}>
              <b>Notes:</b>
              <p className={classes.notesText}>{canyon.notes}</p>
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
              {isOwnedCanyon
                ? "No trips logged yet."
                : "Trip logs are private to the canyon owner."}
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

        <div className={classes.footer}>
          <div className={classes.divider} />
          {isOwnedCanyon ? (
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
                  title="Copy to My Canyons"
                  onClick={() => handleCopyCanyon(false)}
                  disabled={copying}
                >
                  Copy
                </button>
                <button
                  className={classes.ghostBtn}
                  title="Remove from Shared"
                  onClick={handleRemoveShared}
                  disabled={copying}
                >
                  Remove from Shared
                </button>
              </div>
              <button
                className={classes.ghostBtnFull}
                title="Copy to My Canyons and remove from Shared"
                onClick={() => handleCopyCanyon(true)}
                disabled={copying}
              >
                Copy and Remove
              </button>
            </>
          )}
        </div>
      </div>

      <CanyonDialog
        canyon={canyon}
        open={showEdit && !pickingCoords}
        onClose={() => setShowEdit(false)}
        onSaved={onRefetch}
        onPickCoords={onPickCoords}
        onCancelPickCoords={onCancelPickCoords}
        customFieldDefs={canyonCustomFieldDefs}
        onCustomFieldDefsChange={onCanyonCustomFieldDefsChange}
        onMediaChanged={reloadCanyonMedia}
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

      {isOwnedCanyon && (
        <ShareCanyonDialog
          canyon={canyon}
          friends={friends}
          open={showShareDialog}
          onClose={() => setShowShareDialog(false)}
        />
      )}

      <Dialog
        open={showDeleteConfirm}
        onClose={deleting ? undefined : () => setShowDeleteConfirm(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: "var(--theme-primary)",
            color: "var(--theme-text-primary)",
          },
        }}
      >
        <DialogTitle sx={{ color: "var(--theme-text-primary)" }}>
          Delete Canyon
        </DialogTitle>
        <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <DialogContentText sx={{ color: "var(--theme-text-muted)" }}>
            Are you sure you want to delete {canyon.name}? Trip logs and other
            associated data will also be deleted. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowDeleteConfirm(false)}
            disabled={deleting}
            sx={{ color: "var(--theme-text-primary)" }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            color="error"
            variant="contained"
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <TripLogDialog
        open={showTripLogDialog && !pickingCoords}
        onClose={() => {
          setShowTripLogDialog(false);
          setEditingTripLog(undefined);
        }}
        onSaved={() => {
          setShowTripLogDialog(false);
          setEditingTripLog(undefined);
          getTripLogs(canyon.id)
            .then(setTripLogs)
            .catch((err) => {
              console.error(err);
              toast.error(messageFromError(err, "Couldn't refresh trip logs."));
            });
          // Also refresh the global Trip Logs list/search (separate query).
          onRefetchTripLogs();
        }}
        canyons={canyons}
        defaultCanyonId={canyon.id}
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
        canManageMedia={isOwnedCanyon}
        onMediaChanged={onQuotaChanged}
        onEdit={() => {
          setShowTripLogView(false);
          setEditingTripLog(viewingTripLog ?? undefined);
          setViewingTripLog(null);
          setShowTripLogDialog(true);
        }}
        onDeleted={() => {
          getTripLogs(canyon.id)
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

export default CanyonDetailPanel;
