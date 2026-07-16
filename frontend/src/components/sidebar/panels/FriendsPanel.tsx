import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { ChevronRight } from "lucide-react";
import classes from "./FriendsPanel.module.css";
import FriendSharingSection from "./FriendSharingSection";
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
  const [sendingUserIds, setSendingUserIds] = useState<Set<string>>(new Set());
  const [removingFriendId, setRemovingFriendId] = useState<string | null>(null);
  const [loadingRequestId, setLoadingRequestId] = useState<string | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<{
    id: string;
    username: string;
  } | null>(null);
  // Non-null = the sharing audit for that friend replaces the list (fix 24).
  const [openFriend, setOpenFriend] = useState<TFriend | null>(null);
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

  // Refetch on every panel open — friends/requests are otherwise only ever
  // fetched once at app boot (FRIEND-3), so a request received mid-session
  // stays invisible until a full reload.
  useEffect(() => {
    onRefetchFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSendFriendRequest(user: TSearchUser) {
    // Guard against a double-click firing two POSTs for the same user: the
    // second would 409 ("Friend request already pending") and, without this
    // guard, could race the first's success and clobber its feedback (FRIEND-1).
    setSendingUserIds((prev) => new Set(prev).add(user.id));
    try {
      await sendFriendRequest(user.id);
      toast.success(`Friend request sent to ${user.username}.`);
      // Remove just this row rather than the whole result set, so a search
      // with multiple matches can keep going.
      setSearchResults((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't send friend request."));
    } finally {
      setSendingUserIds((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
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

  // The sharing audit takes over the whole panel rather than nesting under the
  // list: at 280px there is no room for both, and the audit is a "go and read
  // this" surface, not a glance.
  if (openFriend) {
    return (
      <div className={classes.optionsContent}>
        <FriendSharingSection
          friend={openFriend}
          onBack={() => setOpenFriend(null)}
          onSharesChanged={onRefetchShared}
        />
      </div>
    );
  }

  return (
    <>
      <div className={classes.optionsContent}>
        <div className={classes.friendSearchContainer}>
          <input
            type="text"
            className={classes.searchInput}
            placeholder="Search by username..."
            value={friendSearch}
            onChange={(e) => setFriendSearch(e.target.value)}
            aria-label="Search friends by username"
          />
          {searchResults.length > 0 && (
            <div className={classes.searchResults}>
              {searchResults.map((user) => (
                <div key={user.id} className={classes.searchResultItem}>
                  <span>{user.username}</span>
                  <button
                    className={classes.addFriendButton}
                    onClick={() => handleSendFriendRequest(user)}
                    disabled={sendingUserIds.has(user.id)}
                  >
                    {sendingUserIds.has(user.id) ? "Sending…" : "Add Friend"}
                  </button>
                </div>
              ))}
            </div>
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
                {/* The name is the affordance into the sharing audit — "what
                    does Bob see?" is a question you ask about a person, so it
                    lives on the person (fix 24). Styled as a tappable row with a
                    drill-in chevron so the affordance is obvious. */}
                <button
                  className={classes.friendNameButton}
                  onClick={() => setOpenFriend(friend)}
                  title={`Sharing with ${friend.username}`}
                >
                  <span className={classes.friendNameText}>
                    {friend.username}
                  </span>
                  <ChevronRight
                    size={16}
                    className={classes.friendChevron}
                    aria-hidden="true"
                  />
                </button>
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
          maxWidth="sm"
          fullWidth
          onClose={removingFriendId ? undefined : () => setShowRemoveConfirm(null)}
          PaperProps={{
            sx: { backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)" },
          }}
        >
          <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}>
            Remove Friend
            <IconButton
              aria-label="Close dialog"
              size="small"
              onClick={() => setShowRemoveConfirm(null)}
              disabled={removingFriendId != null}
              sx={{ color: "var(--theme-text-primary)" }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
            <DialogContentText sx={{ color: "var(--theme-text-primary)" }}>
              Remove {showRemoveConfirm.username}? Shared canyons between you
              will be unshared.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setShowRemoveConfirm(null)}
              disabled={removingFriendId != null}
              sx={{ color: "var(--theme-text-primary)" }}
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
