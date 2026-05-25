import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
} from "@mui/material";
import classes from "./ShareCanyonDialog.module.css";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import type { TCanyon, TFriend, TCanyonShare } from "../../canyonUtils";
import { getCanyonShares, shareCanyonWith, unshareCanyonWith } from "../../canyonUtils";

function ShareCanyonDialog({
  canyon,
  friends,
  open,
  onClose,
}: {
  canyon: TCanyon;
  friends: TFriend[];
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [canyonShares, setCanyonShares] = useState<TCanyonShare[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [shareSearch, setShareSearch] = useState("");
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedFriendIds([]);
    setShareSearch("");
    getCanyonShares(canyon.id)
      .then(setCanyonShares)
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load shares."));
      });
  }, [open, canyon.id, toast]);

  async function handleShareCanyon() {
    if (selectedFriendIds.length === 0) return;
    setSharing(true);
    try {
      for (const friendId of selectedFriendIds) {
        await shareCanyonWith(canyon.id, friendId);
      }
      setSelectedFriendIds([]);
      setShareSearch("");
      getCanyonShares(canyon.id)
        .then(setCanyonShares)
        .catch((err) => {
          console.error(err);
        });
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't share canyon. Please try again."));
    } finally {
      setSharing(false);
    }
  }

  async function handleUnshare(userId: string) {
    try {
      await unshareCanyonWith(canyon.id, userId);
      getCanyonShares(canyon.id)
        .then(setCanyonShares)
        .catch((err) => {
          console.error(err);
        });
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't remove share. Please try again."));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={sharing ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
        },
      }}
    >
      <DialogTitle sx={{ color: "var(--theme-text-primary)" }}>
        Share {canyon.name}
      </DialogTitle>
      <DialogContent>
        {friends.length === 0 ? (
          <span className={classes.caption}>Add friends first to share canyons.</span>
        ) : (
          <div className={classes.content}>
            <TextField
              placeholder="Search friends..."
              value={shareSearch}
              onChange={(e) => setShareSearch(e.target.value)}
              size="small"
              fullWidth
              sx={{ "& .MuiInputBase-input": { fontSize: "0.85em" } }}
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
                      !canyonShares.some((s) => s.sharedWith.id === f.id),
                  )
                  .map((friend) => (
                    <div key={friend.id} className={classes.searchResultItem}>
                      <span>{friend.username}</span>
                      <button
                        className={classes.addToShareButton}
                        onClick={() => {
                          setSelectedFriendIds([...selectedFriendIds, friend.id]);
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
                            selectedFriendIds.filter((fid) => fid !== id),
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
          </div>
        )}
        {canyonShares.length > 0 && (
          <div className={classes.sharedWithList}>
            <span className={classes.sharedWithHeader}>Shared with:</span>
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
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onClose}
          disabled={sharing}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Close
        </Button>
        {friends.length > 0 && (
          <Button
            onClick={handleShareCanyon}
            disabled={sharing || selectedFriendIds.length === 0}
            variant="contained"
            sx={{ backgroundColor: "var(--theme-accent)" }}
          >
            {sharing ? "Sharing..." : "Confirm Share"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default ShareCanyonDialog;
