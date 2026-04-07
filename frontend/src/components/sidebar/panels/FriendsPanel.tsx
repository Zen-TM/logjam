import { useState, useEffect, useRef } from "react";
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
import type { TFriend, TFriendRequest, TSearchUser } from "../../../canyonUtils";
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
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
  const [removingFriendId, setRemovingFriendId] = useState<string | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<{
    id: string;
    username: string;
  } | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (friendSearch.length < 2) {
      setSearchResults([]);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      searchUsers(friendSearch).then(setSearchResults).catch(console.error);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [friendSearch]);

  async function handleSendFriendRequest(addresseeId: string) {
    try {
      await sendFriendRequest(addresseeId);
      setSearchFeedback("Request sent");
      setSearchResults([]);
      setFriendSearch("");
      setTimeout(() => setSearchFeedback(null), 3000);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to send request";
      if (msg.includes("409")) {
        setSearchFeedback("Already friends or request pending");
      } else {
        setSearchFeedback(msg);
      }
      setTimeout(() => setSearchFeedback(null), 3000);
    }
  }

  async function handleAcceptRequest(friendshipId: string) {
    try {
      await acceptFriendRequest(friendshipId);
      onRefetchFriends();
      onRefetchNotifications();
    } catch {
      // ignore
    }
  }

  async function handleDeclineRequest(friendshipId: string) {
    try {
      await declineFriendRequest(friendshipId);
      onRefetchFriends();
    } catch {
      // ignore
    }
  }

  async function handleRemoveFriend(friendshipId: string) {
    setRemovingFriendId(friendshipId);
    try {
      await removeFriend(friendshipId);
      setShowRemoveConfirm(null);
      onRefetchFriends();
      onRefetchShared();
    } catch {
      // ignore
    } finally {
      setRemovingFriendId(null);
    }
  }

  return (
    <>
      <div className={classes.optionsContent}>
        <div className={classes.friendSearchContainer}>
          <TextField
            placeholder="Search by username or email..."
            value={friendSearch}
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
            <Typography
              variant="caption"
              sx={{ color: "var(--content-color)", opacity: 0.7 }}
            >
              {searchFeedback}
            </Typography>
          )}
        </div>

        {friendRequests.length > 0 && (
          <>
            <Typography
              variant="body2"
              sx={{ fontWeight: "bold", mt: 0.5 }}
            >
              Pending Requests
            </Typography>
            <div
              className={classes.scrollList}
              style={{ maxHeight: "150px" }}
            >
              {friendRequests.map((req) => (
                <div key={req.id} className={classes.friendRow}>
                  <span className={classes.friendName}>
                    {req.requester.username}
                  </span>
                  <div className={classes.friendActions}>
                    <button
                      className={classes.acceptButton}
                      onClick={() => handleAcceptRequest(req.id)}
                    >
                      Accept
                    </button>
                    <button
                      className={classes.declineButton}
                      onClick={() => handleDeclineRequest(req.id)}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <Typography variant="body2" sx={{ fontWeight: "bold", mt: 0.5 }}>
          Friends ({friends.length})
        </Typography>
        {friends.length === 0 ? (
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            No friends yet. Search for a username above.
          </Typography>
        ) : (
          <div
            className={classes.scrollList}
            style={{ maxHeight: "200px" }}
          >
            {friends.map((friend) => (
              <div key={friend.id} className={classes.friendRow}>
                <span className={classes.friendName}>
                  {friend.username}
                </span>
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
