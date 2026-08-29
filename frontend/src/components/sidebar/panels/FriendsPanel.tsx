import { useState, useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import classes from "./FriendsPanel.module.css";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import FriendSharingSection from "./FriendSharingSection";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import type {
  TFriend,
  TFriendRequest,
  TFileSendInboxRow,
  TSearchUser,
} from "../../../canyonUtils";
import {
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  getFileSendInbox,
  acceptFileSend,
  declineFileSend,
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
  const [inbox, setInbox] = useState<TFileSendInboxRow[]>([]);
  const [busySendId, setBusySendId] = useState<string | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (friendSearch.length < 3) {
      setSearchResults([]);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    // FEUI-008: guards a stale response landing after a newer query's already
    // replaced it (type "abel" then "abelin" — if "abel"'s GET resolves last,
    // its results must not overwrite "abelin"'s). Same race class MapSearchBox
    // guards with an AbortController; `searchUsers`/`apiFetch` don't take a
    // signal, so this mirrors the cancelled-flag guard used for the same race
    // in canyonUtils.ts's fetch hooks instead.
    let cancelled = false;
    searchTimerRef.current = setTimeout(() => {
      searchUsers(friendSearch)
        .then((results) => { if (!cancelled) setSearchResults(results); })
        .catch((err) => {
          if (cancelled) return;
          console.error(err);
          toast.error(messageFromError(err, "Couldn't search users."));
        });
    }, 300);
    return () => {
      cancelled = true;
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [friendSearch, toast]);

  // Refetch on every panel open — friends/requests are otherwise only ever
  // fetched once at app boot (FRIEND-3), so a request received mid-session
  // stays invisible until a full reload.
  useEffect(() => {
    onRefetchFriends();
    refreshInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshInbox() {
    getFileSendInbox()
      .then(setInbox)
      .catch((err) => {
        console.error(err);
      });
  }

  // A sent copy is the recipient's to keep, so "accept" is a download, not a
  // subscription — and on web it is ONLY a download: there is no vector-import
  // feature here to receive it into.
  //
  // The API flips the row to `accepted` when it issues the URL, not when the
  // bytes land, so an accept over a dead connection leaves an accepted row and
  // no file. Accepted rows stay downloadable until the send expires, which is
  // what the "Download again" affordance below is for.
  async function handleAcceptSend(row: TFileSendInboxRow) {
    setBusySendId(row.fileSendId);
    try {
      const { downloadUrl } = await acceptFileSend(row.fileSendId);
      // The presigned URL carries its own Content-Disposition; a plain anchor
      // click is enough, and a cross-origin `download` attribute would be
      // ignored anyway.
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.rel = "noopener";
      anchor.click();
      refreshInbox();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't download that file."));
    } finally {
      setBusySendId(null);
    }
  }

  async function handleDeclineSend(fileSendId: string) {
    setBusySendId(fileSendId);
    try {
      await declineFileSend(fileSendId);
      refreshInbox();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't decline that file."));
    } finally {
      setBusySendId(null);
    }
  }

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

        {inbox.length > 0 && (
          <>
            <span className={classes.sectionTitle}>Files sent to you</span>
            <div className={classes.pendingScrollList}>
              {inbox.map((row) => (
                <div key={row.fileSendId} className={classes.friendRow}>
                  <span className={classes.friendName}>
                    {row.filename}
                    <br />
                    <small>from {row.sentBy.username}</small>
                  </span>
                  <div className={classes.friendActions}>
                    <button
                      className={classes.acceptButton}
                      onClick={() => void handleAcceptSend(row)}
                      disabled={busySendId === row.fileSendId}
                    >
                      {row.status === "accepted" ? "Download again" : "Download"}
                    </button>
                    {row.status !== "accepted" && (
                      <button
                        className={classes.declineButton}
                        onClick={() => void handleDeclineSend(row.fileSendId)}
                        disabled={busySendId === row.fileSendId}
                      >
                        Decline
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <span className={classes.caption}>
              These are copies. Downloading keeps the file on your computer —
              Logjam on the web doesn&rsquo;t import GPX or KML, so open it in
              the mobile app or another tool.
            </span>
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

      <ConfirmDialog
        open={showRemoveConfirm != null}
        title="Remove Friend"
        message={
          <>
            Remove {showRemoveConfirm?.username}? Shared canyons between you will
            be unshared.
          </>
        }
        confirmLabel="Remove"
        busy={removingFriendId != null}
        onConfirm={() => {
          if (showRemoveConfirm) handleRemoveFriend(showRemoveConfirm.id);
        }}
        onClose={() => setShowRemoveConfirm(null)}
      />
    </>
  );
}

export default FriendsPanel;
