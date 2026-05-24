import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  TextField,
} from "@mui/material";
import classes from "./CanyonDetailPanel.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import CanyonDialog from "../../dialogs/CanyonDialog";
import TripLogDialog from "../../dialogs/TripLogDialog";
import TripLogViewDialog from "../../dialogs/TripLogViewDialog";
import type { TCanyon, TFriend, TCanyonShare, TTripLog } from "../../../canyonUtils";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import {
  formatCanyonGrade,
  deleteCanyon,
  shareCanyonWith,
  unshareCanyonWith,
  getCanyonShares,
  copyCanyon,
  getTripLogs,
} from "../../../canyonUtils";

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Trip log state
  const [tripLogs, setTripLogs] = useState<TTripLog[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [showTripLogDialog, setShowTripLogDialog] = useState(false);
  const [showTripLogView, setShowTripLogView] = useState(false);
  const [viewingTripLog, setViewingTripLog] = useState<TTripLog | null>(null);
  const [editingTripLog, setEditingTripLog] = useState<TTripLog | undefined>(undefined);

  // Sharing state
  const [showShareSelector, setShowShareSelector] = useState(false);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [shareSearch, setShareSearch] = useState("");
  const [canyonShares, setCanyonShares] = useState<TCanyonShare[]>([]);
  const [sharing, setSharing] = useState(false);
  const [copying, setCopying] = useState(false);

  // Reset sharing state and fetch shares when canyon changes
  useEffect(() => {
    setShowShareSelector(false);
    setSelectedFriendIds([]);
    setShareSearch("");
    if (!canyon || !isOwnedCanyon) {
      setCanyonShares([]);
      return;
    }
    getCanyonShares(canyon.id)
      .then(setCanyonShares)
      .catch((err) => { console.error(err); toast.error(messageFromError(err, "Couldn't load shares.")); });
  }, [canyon?.id, isOwnedCanyon, toast]);

  // Fetch trip logs when canyon changes
  useEffect(() => {
    if (!canyon) {
      setTripLogs([]);
      return;
    }
    setLoadingTrips(true);
    getTripLogs(canyon.id)
      .then(setTripLogs)
      .catch((err) => { console.error(err); toast.error(messageFromError(err, "Couldn't load trip logs.")); })
      .finally(() => setLoadingTrips(false));
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

  async function handleShareCanyon() {
    if (!canyon || selectedFriendIds.length === 0) return;
    setSharing(true);
    try {
      for (const friendId of selectedFriendIds) {
        await shareCanyonWith(canyon.id, friendId);
      }
      setSelectedFriendIds([]);
      setShowShareSelector(false);
      getCanyonShares(canyon.id)
        .then(setCanyonShares)
        .catch((err) => { console.error(err); });
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't share canyon. Please try again."));
    } finally {
      setSharing(false);
    }
  }

  async function handleUnshare(userId: string) {
    if (!canyon) return;
    try {
      await unshareCanyonWith(canyon.id, userId);
      getCanyonShares(canyon.id)
        .then(setCanyonShares)
        .catch((err) => { console.error(err); });
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't remove share. Please try again."));
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

  const canyonGrade = formatCanyonGrade(canyon);

  return (
    <>
      <div className={classes.canyonInfo}>
        {canyon.altNames.length > 0 && (
          <p className={classes.altNames}>
            Also known as: {canyon.altNames.join(", ")}
          </p>
        )}
        {canyon.ropeWikiId != null && (
          <p className={classes.disclaimer}>
            Canyon data imported from RopeWiki.
          </p>
        )}
        {canyonGrade && (
          <p>
            <b>Grade:</b> {canyonGrade}
          </p>
        )}
        <p>
          <b>Location:</b> {canyon.latitude.toFixed(4)},{" "}
          {canyon.longitude.toFixed(4)}
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
        {isOwnedCanyon && (
          <div className={classes.canyonActions}>
            <button
              className={classes.editButton}
              onClick={() => setShowEdit(true)}
            >
              Edit
            </button>
            <button
              className={classes.logTripButton}
              onClick={() => {
                setEditingTripLog(undefined);
                setShowTripLogDialog(true);
              }}
            >
              Log Trip
            </button>
            <button
              className={classes.deleteButton}
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete
            </button>
          </div>
        )}

        {/* Sharing UI (owned canyons only) */}
        {isOwnedCanyon && (
          <div className={classes.shareSection}>
            <button
              className={classes.shareButton}
              onClick={() => setShowShareSelector(!showShareSelector)}
            >
              Share Canyon
            </button>
            {showShareSelector && (
              <div className={classes.shareSelector}>
                {friends.length === 0 ? (
                  <span className={classes.caption}>
                    Add friends first to share canyons.
                  </span>
                ) : (
                  <>
                    <TextField
                      placeholder="Search friends..."
                      value={shareSearch}
                      onChange={(e) => setShareSearch(e.target.value)}
                      size="small"
                      fullWidth
                      sx={{
                        "& .MuiInputBase-input": { fontSize: "0.85em" },
                      }}
                    />
                    {shareSearch.length > 0 && (
                      <div className={classes.searchResults}>
                        {friends
                          .filter(
                            (f) =>
                              f.username
                                .toLowerCase()
                                .includes(shareSearch.toLowerCase()) &&
                              !selectedFriendIds.includes(f.id) &&
                              !canyonShares.some(
                                (s) => s.sharedWith.id === f.id,
                              ),
                          )
                          .map((friend) => (
                            <div
                              key={friend.id}
                              className={classes.searchResultItem}
                            >
                              <span>{friend.username}</span>
                              <button
                                className={classes.addToShareButton}
                                onClick={() => {
                                  setSelectedFriendIds([
                                    ...selectedFriendIds,
                                    friend.id,
                                  ]);
                                  setShareSearch("");
                                }}
                              >
                                Add
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                    {selectedFriendIds.length > 0 && (
                      <div className={classes.selectedFriends}>
                        {selectedFriendIds.map((id) => {
                          const f = friends.find((fr) => fr.id === id);
                          if (!f) return null;
                          return (
                            <span key={id} className={classes.friendChip}>
                              {f.username}
                              <button
                                className={classes.chipRemove}
                                onClick={() =>
                                  setSelectedFriendIds(
                                    selectedFriendIds.filter(
                                      (fid) => fid !== id,
                                    ),
                                  )
                                }
                              >
                                ✕
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <button
                      className={classes.shareButton}
                      onClick={handleShareCanyon}
                      disabled={sharing || selectedFriendIds.length === 0}
                    >
                      {sharing ? "Sharing..." : "Confirm Share"}
                    </button>
                  </>
                )}
              </div>
            )}
            {canyonShares.length > 0 && (
              <div className={classes.sharedWithList}>
                <span className={classes.tripLogsHeader}>Shared with:</span>
                {canyonShares.map((share) => (
                  <div key={share.id} className={classes.sharedWithRow}>
                    <span>{share.sharedWith.username}</span>
                    <button
                      className={classes.unshareButton}
                      onClick={() => handleUnshare(share.sharedWith.id)}
                    >
                      Unshare
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Shared canyon actions */}
        {!isOwnedCanyon && (
          <div className={classes.shareSection}>
            <div className={classes.copyActions}>
              <button
                className={classes.copyButton}
                onClick={() => handleCopyCanyon(false)}
                disabled={copying}
              >
                Copy to My Canyons
              </button>
              <button
                className={classes.copyButton}
                onClick={() => handleCopyCanyon(true)}
                disabled={copying}
              >
                Copy and Remove
              </button>
            </div>
            <button
              className={classes.removeSharedButton}
              onClick={handleRemoveShared}
              disabled={copying}
            >
              Remove from Shared
            </button>
          </div>
        )}

        {/* Trip Logs list */}
        <div className={classes.tripLogsSection}>
          <div className={classes.tripLogsHeader}>
            Trip Logs {tripLogs.length > 0 && `(${tripLogs.length})`}
          </div>
          {loadingTrips ? (
            <span className={classes.caption}>Loading...</span>
          ) : tripLogs.length === 0 ? (
            <span className={classes.caption}>
              {isOwnedCanyon ? "No trips logged yet." : "Trip logs are private to the canyon owner."}
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
                      {trip.notes.length > 60 ? trip.notes.slice(0, 60) + "…" : trip.notes}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit canyon dialog */}
      <CanyonDialog
        canyon={canyon}
        open={showEdit && !pickingCoords}
        onClose={() => setShowEdit(false)}
        onSaved={onRefetch}
        onPickCoords={onPickCoords}
        onCancelPickCoords={onCancelPickCoords}
      />

      {/* Delete confirmation */}
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

      {/* Trip Log create/edit dialog */}
      <TripLogDialog
        open={showTripLogDialog && !pickingCoords}
        onClose={() => {
          setShowTripLogDialog(false);
          setEditingTripLog(undefined);
        }}
        onSaved={() => {
          setShowTripLogDialog(false);
          setEditingTripLog(undefined);
          // Refresh trip logs
          getTripLogs(canyon.id)
            .then(setTripLogs)
            .catch((err) => { console.error(err); toast.error(messageFromError(err, "Couldn't refresh trip logs.")); });
        }}
        canyonId={canyon.id}
        canyonName={canyon.name}
        tripLog={editingTripLog}
        customFieldDefs={customFieldDefs}
        onCustomFieldDefsChange={onCustomFieldDefsChange}
      />

      {/* Trip Log view dialog */}
      <TripLogViewDialog
        open={showTripLogView}
        onClose={() => {
          setShowTripLogView(false);
          setViewingTripLog(null);
        }}
        tripLog={viewingTripLog}
        canyonName={canyon.name}
        customFieldDefs={customFieldDefs}
        onEdit={() => {
          setShowTripLogView(false);
          setEditingTripLog(viewingTripLog ?? undefined);
          setViewingTripLog(null);
          setShowTripLogDialog(true);
        }}
        onDeleted={() => {
          getTripLogs(canyon.id)
            .then(setTripLogs)
            .catch((err) => { console.error(err); toast.error(messageFromError(err, "Couldn't refresh trip logs.")); });
          onQuotaChanged();
        }}
      />
    </>
  );
}

export default CanyonDetailPanel;
