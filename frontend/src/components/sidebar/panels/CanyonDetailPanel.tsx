import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from "@mui/material";
import { Pencil, TriangleAlert, X } from "lucide-react";
import classes from "./CanyonDetailPanel.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import CanyonDialog from "../../dialogs/CanyonDialog";
import ShareCanyonDialog from "../../dialogs/ShareCanyonDialog";
import TripLogDialog from "../../dialogs/TripLogDialog";
import TripLogViewDialog from "../../dialogs/TripLogViewDialog";
import type { TCanyon, TFriend, TTripLog } from "../../../canyonUtils";
import type { TripLogCustomFieldDef, MediaItem } from "@logjam/shared";
import {
  formatCanyonGrade,
  deleteCanyon,
  copyCanyon,
  unshareCanyonWith,
  getTripLogs,
  getCanyonDetail,
} from "../../../canyonUtils";
import MediaUpload from "../../media/MediaUpload";
import MediaGallery from "../../media/MediaGallery";

function CanyonDetailPanel({
  canyon,
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
  onQuotaChanged,
}: {
  canyon: TCanyon | undefined;
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
  onQuotaChanged: () => void;
}) {
  const toast = useToast();
  const [showEdit, setShowEdit] = useState(false);
  const [safetyDismissed, setSafetyDismissed] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);

  const [tripLogs, setTripLogs] = useState<TTripLog[]>([]);
  const [canyonMedia, setCanyonMedia] = useState<MediaItem[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [showTripLogDialog, setShowTripLogDialog] = useState(false);
  const [showTripLogView, setShowTripLogView] = useState(false);
  const [viewingTripLog, setViewingTripLog] = useState<TTripLog | null>(null);
  const [editingTripLog, setEditingTripLog] = useState<TTripLog | undefined>(undefined);

  const [copying, setCopying] = useState(false);

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

  function handleMediaUploaded(item: MediaItem) {
    setCanyonMedia((prev) => [...prev, item]);
    onQuotaChanged();
  }

  function handleMediaDeleted(id: string) {
    setCanyonMedia((prev) => prev.filter((m) => m.id !== id));
    onQuotaChanged();
  }

  const canyonGrade = formatCanyonGrade(canyon);

  return (
    <>
      <div className={classes.root}>
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
              onClick={() => setSafetyDismissed(true)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {(canyon.ropeWikiId != null || canyon.altNames.length > 0) && (
          <div className={classes.headerMeta}>
            {canyon.ropeWikiId != null && (
              <p className={classes.disclaimer}>Canyon data imported from RopeWiki.</p>
            )}
            {canyon.altNames.length > 0 && (
              <p className={classes.altNames}>Also known as: {canyon.altNames.join(", ")}</p>
            )}
          </div>
        )}

        <div
          className={classes.attributesBox}
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
          {canyon.wetsuits != null && (
            <p>
              <b>Wetsuits Required:</b> {canyon.wetsuits}/5
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

        <div className={classes.mediaRegion}>
          <div className={classes.divider} />
          <div className={classes.mediaHeader}>
            Photos &amp; Files {canyonMedia.length > 0 && `(${canyonMedia.length})`}
          </div>
          <div className={classes.mediaScroll}>
            <MediaGallery
              media={canyonMedia}
              canDelete={isOwnedCanyon}
              onDeleted={handleMediaDeleted}
              emptyText={
                isOwnedCanyon
                  ? "No photos or files yet."
                  : "No shared photos or files."
              }
            />
            {isOwnedCanyon && (
              <MediaUpload
                linkedType="canyon"
                linkedId={canyon.id}
                onUploaded={handleMediaUploaded}
              />
            )}
          </div>
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
        }}
        canyonId={canyon.id}
        canyonName={canyon.name}
        tripLog={editingTripLog}
        customFieldDefs={customFieldDefs}
        onCustomFieldDefsChange={onCustomFieldDefsChange}
      />

      <TripLogViewDialog
        open={showTripLogView}
        onClose={() => {
          setShowTripLogView(false);
          setViewingTripLog(null);
        }}
        tripLog={viewingTripLog}
        canyonName={canyon.name}
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
        }}
      />
    </>
  );
}

export default CanyonDetailPanel;
