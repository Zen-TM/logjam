// The friend-picker for SHARING — a live, read-only view of something the
// owner keeps and can revoke at any time.
//
// One dialog for canyons and for the four direct-share types (waypoint, route,
// topoJob, geoPdfJob), because "who can see this, and take it back" is one
// interaction. The endpoints differ — canyons keep /canyons/:id/share, the rest
// use /shares — so the three calls arrive as props rather than being switched
// on a type here.
//
// NOT for "send a copy" (FileSend). That hands over a file the recipient keeps
// permanently and cannot be un-sent; wording the two alike teaches people that
// a sent file can be recalled. See shared/src/sharing.ts.
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
} from "@mui/material";
import classes from "./ShareDialog.module.css";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import type { TFriend } from "../../canyonUtils";

/** Enough of a share row to list and revoke it. Both endpoints return this. */
export type ShareRecipientRow = {
  id: string;
  sharedWith: { id: string; username: string };
};

function ShareDialog({
  title,
  blurb,
  friends,
  open,
  onClose,
  listShares,
  share,
  unshare,
}: {
  /** Dialog heading, e.g. `Share ${canyon.name}`. */
  title: string;
  /** What the recipient gets, in the caller's own words — a canyon share and a
   *  route share do not grant the same things. */
  blurb: React.ReactNode;
  friends: TFriend[];
  open: boolean;
  onClose: () => void;
  listShares: () => Promise<ShareRecipientRow[]>;
  share: (userId: string) => Promise<unknown>;
  unshare: (userId: string) => Promise<unknown>;
}) {
  const toast = useToast();
  const [shares, setShares] = useState<ShareRecipientRow[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [shareSearch, setShareSearch] = useState("");
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedFriendIds([]);
    setShareSearch("");
    listShares()
      .then(setShares)
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load shares."));
      });
    // `listShares` is a fresh closure each render; depending on it would refetch
    // forever. Open/close is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, toast]);

  function refreshShares() {
    listShares()
      .then(setShares)
      .catch((err) => {
        console.error(err);
      });
  }

  async function handleShare() {
    if (selectedFriendIds.length === 0) return;
    const sharedNames = selectedFriendIds
      .map((id) => friends.find((f) => f.id === id)?.username)
      .filter((name): name is string => Boolean(name));
    setSharing(true);
    try {
      for (const friendId of selectedFriendIds) {
        await share(friendId);
      }
      setSelectedFriendIds([]);
      setShareSearch("");
      refreshShares();
      toast.success(
        sharedNames.length === 1
          ? `Shared with ${sharedNames[0]}.`
          : `Shared with ${sharedNames.length} friends.`,
      );
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't share. Please try again."));
    } finally {
      setSharing(false);
    }
  }

  async function handleUnshare(userId: string) {
    try {
      await unshare(userId);
      refreshShares();
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
      <DialogTitle sx={{ color: "var(--theme-text-primary)" }}>{title}</DialogTitle>
      <DialogContent>
        {friends.length === 0 ? (
          <span className={classes.caption}>Add friends first to share.</span>
        ) : (
          <div className={classes.content}>
            <TextField
              inputProps={{ "aria-label": "Search friends to share with" }}
              placeholder="Search friends..."
              value={shareSearch}
              onChange={(e) => setShareSearch(e.target.value)}
              size="small"
              fullWidth
              sx={{ "& .MuiInputBase-input": { fontSize: "0.85em" } }}
            />
            {shareSearch.length > 0 && (() => {
              const matches = friends.filter(
                (f) =>
                  f.username
                    .toLowerCase()
                    .includes(shareSearch.toLowerCase()) &&
                  !selectedFriendIds.includes(f.id) &&
                  !shares.some((s) => s.sharedWith.id === f.id),
              );
              return (
                <div className={classes.searchResults}>
                  {matches.length === 0 ? (
                    <span className={classes.caption}>No matching friends.</span>
                  ) : (
                    matches.map((friend) => (
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
                    ))
                  )}
                </div>
              );
            })()}
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
        {friends.length > 0 && <p className={classes.caption}>{blurb}</p>}
        {shares.length > 0 && (
          <div className={classes.sharedWithList}>
            <span className={classes.sharedWithHeader}>Shared with:</span>
            {shares.map((row) => (
              <div key={row.id} className={classes.sharedWithRow}>
                <span>{row.sharedWith.username}</span>
                <button
                  className={classes.unshareButton}
                  onClick={() => handleUnshare(row.sharedWith.id)}
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
            onClick={handleShare}
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

export default ShareDialog;
