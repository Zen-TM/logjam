import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  TextField,
} from "@mui/material";
import classes from "./FriendsPanel.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import type {
  TFriend,
  TFriendRequest,
  TSearchUser,
} from "../../../canyonUtils";
import {
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
} from "../../../canyonUtils";

function FriendsPanel({
  friends,
  friendRequests,
  onRefetchFriends,
  onRefetchShared,
  onRefetchNotifications,
}: {
  friends: TFriend[];
  friendRequests: TFriendRequest[];
  onRefetchFriends: () => void;
  onRefetchShared: () => void;
  onRefetchNotifications: () => void;
}) {
  const [friendSearch, setFriendSearch] = useState("");
  const [searchResults, setSearchResults] = useState<TSearchUser[]>([]);
  const [searchFeedback, setSearchFeedback] = useState<{ message: string; isSuccess: boolean } | null>(null);
  const [removingFriendId, setRemovingFriendId] = useState<string | null>(null);
  const [loadingRequestId, setLoadingRequestId] = useState<string | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<{
    id: string;
    username: string;
  } | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (friendSearch.length < 3) {
      setSearchResults([]);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      searchUsers(friendSearch)
        .then(setSearchResults)
        .catch((err) => { console.error(err); toast.error(messageFromError(err, "Couldn't search users.")); });
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [friendSearch, toast]);

  const clearFeedback = useCallback(() => setSearchFeedback(null), []);

  async function handleSendFriendRequest(addresseeId: string) {
    try {
      await sendFriendRequest(addresseeId);
      setSearchFeedback({ message: "Friend request sent.", isSuccess: true });
      setSearchResults([]);
      setFriendSearch("");
      setTimeout(clearFeedback, 3000);
    } catch (err) {
      console.error(err);
      setSearchFeedback({ message: messageFromError(err, "Couldn't send friend request."), isSuccess: false });
      setTimeout(clearFeedback, 3000);
    }
  }

  async function handleAcceptRequest(friendshipId: string) {
    setLoadingRequestId(friendshipId);
    try {
      await acceptFriendRequest(friendshipId);
      onRefetchFriends();
      onRefetchNotifications();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't accept friend request."));
    } finally {
      setLoadingRequestId(null);
    }
  }

  async function handleDeclineRequest(friendshipId: string) {
    setLoadingRequestId(friendshipId);
    try {
      await declineFriendRequest(friendshipId);
      onRefetchFriends();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't decline friend request."));
    } finally {
      setLoadingRequestId(null);
    }
  }

  async function handleRemoveFriend(friendshipId: string) {
    setRemovingFriendId(friendshipId);
    try {
      await removeFriend(friendshipId);
      setShowRemoveConfirm(null);
      onRefetchFriends();
      onRefetchShared();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't remove friend."));
    } finally {
      setRemovingFriendId(null);
    }
  }

  return (
    <>
      <div className={classes.optionsContent}>
        <div className={classes.friendSearchContainer}>
          <TextField
            placeholder="Search by username..."
            value={friendSearch}
            color="secondary"
            onChange={(e) => setFriendSearch(e.target.value)}
            size="small"
            fullWidth
            sx={{ "& .MuiInputBase-input": { fontSize: "0.85em" } }}
          />
          {searchResults.length > 0 && (
            <div className={classes.searchResults}>
              {searchResults.map((user) => (
                <div key={user.id} className={classes.searchResultItem}>
                  <span>{user.username}</span>
                  <button
                    className={classes.addFriendButton}
                    onClick={() => handleSendFriendRequest(user.id)}
                  >
                    Add Friend
                  </button>
                </div>
              ))}
            </div>
          )}
          {searchFeedback && (
            <span
              className={classes.caption}
              style={{ color: searchFeedback.isSuccess ? "var(--theme-text-muted)" : "var(--theme-warning)" }}
            >
              {searchFeedback.message}
            </span>
          )}
        </div>

        {friendRequests.length > 0 && (
          <>
            <span className={classes.sectionTitle}>Pending Requests</span>
            <div className={classes.pendingScrollList}>
              {friendRequests.map((req) => (
                <div key={req.id} className={classes.friendRow}>
                  <span className={classes.friendName}>
                    {req.requester.username}
                  </span>
                  <div className={classes.friendActions}>
                    <button
                      className={classes.acceptButton}
                      onClick={() => handleAcceptRequest(req.id)}
                      disabled={loadingRequestId === req.id}
                    >
                      Accept
                    </button>
                    <button
                      className={classes.declineButton}
                      onClick={() => handleDeclineRequest(req.id)}
                      disabled={loadingRequestId === req.id}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <span className={classes.sectionTitle}>Friends ({friends.length})</span>
        {friends.length === 0 ? (
          <span className={classes.caption}>
            No friends yet. Search for a username above.
          </span>
        ) : (
          <div className={classes.friendsScrollList}>
            {friends.map((friend) => (
              <div key={friend.id} className={classes.friendRow}>
                <span className={classes.friendName}>{friend.username}</span>
                <button
                  className={classes.removeButton}
                  onClick={() =>
                    setShowRemoveConfirm({
                      id: friend.friendshipId,
                      username: friend.username,
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showRemoveConfirm && (
        <Dialog
          open
          onClose={
            removingFriendId ? undefined : () => setShowRemoveConfirm(null)
          }
        >
          <DialogTitle>Remove Friend</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Remove {showRemoveConfirm.username}? Shared canyons between you
              will be unshared.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setShowRemoveConfirm(null)}
              disabled={removingFriendId != null}
            >
              Cancel
            </Button>
            <Button
              onClick={() => handleRemoveFriend(showRemoveConfirm.id)}
              color="error"
              variant="contained"
              disabled={removingFriendId != null}
            >
              {removingFriendId ? "Removing..." : "Remove"}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}

export default FriendsPanel;
