import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  TextField,
  Typography,
} from "@mui/material";
import classes from "../Sidebar.module.css";
import CanyonDialog from "../../CanyonDialog";
import type { TCanyon, TFriend, TCanyonShare } from "../../../canyonUtils";
import {
  formatCanyonGrade,
  deleteCanyon,
  shareCanyonWith,
  unshareCanyonWith,
  getCanyonShares,
  copyCanyon,
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
}) {
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    getCanyonShares(canyon.id).then(setCanyonShares).catch(console.error);
  }, [canyon?.id, isOwnedCanyon]);

  if (!canyon) {
    return (
      <Typography variant="caption" sx={{ opacity: 0.6 }}>
        No canyon selected.
      </Typography>
    );
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
    } catch {
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
      getCanyonShares(canyon.id).then(setCanyonShares).catch(console.error);
    } catch {
      // ignore
    } finally {
      setSharing(false);
    }
  }

  async function handleUnshare(userId: string) {
    if (!canyon) return;
    try {
      await unshareCanyonWith(canyon.id, userId);
      getCanyonShares(canyon.id).then(setCanyonShares).catch(console.error);
    } catch {
      // ignore
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
    } catch {
      // ignore
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
    } catch {
      // ignore
    } finally {
      setCopying(false);
    }
  }

  const canyonGrade = formatCanyonGrade(canyon);

  return (
    <>
      <div className={classes.canyonInfo} style={{ padding: 0 }}>
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
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                    Add friends first to share canyons.
                  </Typography>
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
                                className={classes.addFriendButton}
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
                <Typography
                  variant="body2"
                  sx={{ fontWeight: "bold", mt: 0.5, mb: 0.3 }}
                >
                  Shared with:
                </Typography>
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
              className={classes.deleteButton}
              style={{ width: "100%", marginTop: "0.5em" }}
              onClick={handleRemoveShared}
              disabled={copying}
            >
              Remove from Shared
            </button>
          </div>
        )}
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
      >
        <DialogTitle>Delete Canyon</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete {canyon.name}? Trip logs and other
            associated data will also be deleted. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowDeleteConfirm(false)}
            disabled={deleting}
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
    </>
  );
}

export default CanyonDetailPanel;
