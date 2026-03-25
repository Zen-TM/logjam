import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Switch,
  Box,
  Typography,
  TextField,
} from "@mui/material";
import classes from "./Sidebar.module.css";
import Arrow from "../../assets/arrow.svg";
import SidebarModule from "./sidebarModule/SidebarModule";
import Filters from "./sidebarModule/filters/Filters";
import CanyonDialog from "../CanyonDialog";
import type {
  TCanyon,
  TFilters,
  RefreshResult,
  TFriend,
  TFriendRequest,
  TNotification,
  TSearchUser,
  TCanyonShare,
} from "../../canyonUtils";
import {
  formatCanyonGrade,
  deleteCanyon,
  refreshFromRopeWiki,
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  shareCanyonWith,
  unshareCanyonWith,
  getCanyonShares,
  copyCanyon,
  markNotificationRead,
  markAllNotificationsRead,
  clearReadNotifications,
} from "../../canyonUtils";

function Sidebar({
  onChangeFilters,
  filters,
  selectedCanyonID,
  setSelectedCanyonID,
  canyons,
  sidebarOpen,
  setSidebarOpen,
  onRefetch,
  onRefetchShared,
  onPickCoords,
  pickingCoords,
  onCancelPickCoords,
  showOwnedCanyons,
  setShowOwnedCanyons,
  showSharedCanyons,
  setShowSharedCanyons,
  ownedCanyonIds,
  friends,
  friendRequests,
  onRefetchFriends,
  notifications,
  unreadCount,
  onRefetchNotifications,
  onStartAreaSelection,
  selectingArea,
  onCancelAreaSelection,
  selectedAreaCanyonIds,
  onClearAreaSelection,
}: {
  onChangeFilters: (filters: TFilters) => void;
  filters: TFilters;
  selectedCanyonID: string | null;
  setSelectedCanyonID: (id: string | null) => void;
  canyons: TCanyon[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onRefetch: () => void;
  onRefetchShared: () => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  pickingCoords: boolean;
  onCancelPickCoords: () => void;
  showOwnedCanyons: boolean;
  setShowOwnedCanyons: (show: boolean) => void;
  showSharedCanyons: boolean;
  setShowSharedCanyons: (show: boolean) => void;
  ownedCanyonIds: Set<string>;
  friends: TFriend[];
  friendRequests: TFriendRequest[];
  onRefetchFriends: () => void;
  notifications: TNotification[];
  unreadCount: number;
  onRefetchNotifications: () => void;
  onStartAreaSelection: () => void;
  selectingArea: boolean;
  onCancelAreaSelection: () => void;
  selectedAreaCanyonIds: string[];
  onClearAreaSelection: () => void;
}) {
  const canyon = canyons.find((c) => c.id === selectedCanyonID);
  const isOwnedCanyon = canyon != null && ownedCanyonIds.has(canyon.id);
  const [showEdit, setShowEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(
    null,
  );

  // Friends state
  const [friendSearch, setFriendSearch] = useState("");
  const [searchResults, setSearchResults] = useState<TSearchUser[]>([]);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
  const [removingFriendId, setRemovingFriendId] = useState<string | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<{
    id: string;
    username: string;
  } | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notifications state
  const [showNotifications, setShowNotifications] = useState(false);

  // Sharing state
  const [showShareSelector, setShowShareSelector] = useState(false);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [shareSearch, setShareSearch] = useState("");
  const [canyonShares, setCanyonShares] = useState<TCanyonShare[]>([]);
  const [sharing, setSharing] = useState(false);
  const [copying, setCopying] = useState(false);

  // Bulk area action state
  const [bulkShareFriendIds, setBulkShareFriendIds] = useState<string[]>([]);
  const [bulkShareSearch, setBulkShareSearch] = useState("");
  const [bulkSharing, setBulkSharing] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // Debounced friend search
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

  // Reset sharing state and fetch shares when canyon selection changes
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

  async function handleSendFriendRequest(addresseeId: string) {
    try {
      await sendFriendRequest(addresseeId);
      setSearchFeedback("Request sent");
      setSearchResults([]);
      setFriendSearch("");
      setTimeout(() => setSearchFeedback(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send request";
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

  const selectedAreaCanyons = selectedAreaCanyonIds
    .map((id) => canyons.find((c) => c.id === id))
    .filter((c): c is TCanyon => c != null);
  const ownedAreaCanyons = selectedAreaCanyons.filter((c) =>
    ownedCanyonIds.has(c.id),
  );

  async function handleBulkShare() {
    if (bulkShareFriendIds.length === 0 || ownedAreaCanyons.length === 0)
      return;
    setBulkSharing(true);
    try {
      for (const c of ownedAreaCanyons) {
        for (const fId of bulkShareFriendIds) {
          try {
            await shareCanyonWith(c.id, fId);
          } catch {
            // skip duplicates / errors
          }
        }
      }
      setBulkShareFriendIds([]);
      onClearAreaSelection();
    } catch {
      // ignore
    } finally {
      setBulkSharing(false);
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    try {
      for (const c of ownedAreaCanyons) {
        await deleteCanyon(c.id);
      }
      setShowBulkDeleteConfirm(false);
      onClearAreaSelection();
      onRefetch();
    } catch {
      // ignore
    } finally {
      setBulkDeleting(false);
    }
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

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await refreshFromRopeWiki();
      setRefreshResult(result);
      onRefetch();
    } catch {
      setRefreshResult(null);
    } finally {
      setRefreshing(false);
    }
  }

  function sidebarModules() {
    return (
      <>
        <SidebarModule sidebarOpen={sidebarOpen} moduleName="Canyon Options">
          <div className={classes.optionsContent}>
            <button
              className={classes.addButton}
              onClick={() => setShowAdd(true)}
            >
              + Add Canyon
            </button>

            <div className={classes.toggleRow}>
              <span>Show my canyons</span>
              <Switch
                size="small"
                checked={showOwnedCanyons}
                onChange={(_, checked) => setShowOwnedCanyons(checked)}
                sx={{
                  "& .MuiSwitch-switchBase.Mui-checked": {
                    color: "#f97316",
                  },
                  "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
                    backgroundColor: "#f97316",
                  },
                }}
              />
            </div>
            <div className={classes.toggleRow}>
              <span>Show shared canyons</span>
              <Switch
                size="small"
                checked={showSharedCanyons}
                onChange={(_, checked) => setShowSharedCanyons(checked)}
                sx={{
                  "& .MuiSwitch-switchBase.Mui-checked": {
                    color: "#3b82f6",
                  },
                  "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
                    backgroundColor: "#3b82f6",
                  },
                }}
              />
            </div>

            <button
              className={classes.refreshButton}
              onClick={
                selectingArea ? onCancelAreaSelection : onStartAreaSelection
              }
            >
              {selectingArea ? "Cancel Selection" : "Select Area"}
            </button>

            <button
              className={classes.refreshButton}
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh from RopeWiki"}
            </button>
            {refreshResult && (
              <Typography
                variant="caption"
                sx={{ color: "var(--content-color)", opacity: 0.7 }}
              >
                {refreshResult.added} added, {refreshResult.updated} updated,{" "}
                {refreshResult.unchanged} unchanged
                {refreshResult.userEdited > 0 &&
                  `, ${refreshResult.userEdited} kept (edited)`}
              </Typography>
            )}
          </div>
        </SidebarModule>
        <span className={classes.separator} />
        <SidebarModule sidebarOpen={sidebarOpen} moduleName="Friends">
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
        </SidebarModule>
        <span className={classes.separator} />
        <SidebarModule sidebarOpen={sidebarOpen} moduleName="Filters">
          <Filters onChangeFilters={onChangeFilters} filters={filters} />
        </SidebarModule>
        <span className={classes.separator} />
      </>
    );
  }

  function canyonInfo() {
    if (!canyon) return null;
    const canyonGrade = formatCanyonGrade(canyon);

    return (
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
        {!isOwnedCanyon && canyon && (
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
    );
  }
  return (
    <div
      className={classes.sidebar}
      style={{
        width: sidebarOpen ? "300px" : "50px",
        pointerEvents: pickingCoords || selectingArea ? "none" : undefined,
        opacity: pickingCoords || selectingArea ? 0.5 : undefined,
      }}
    >
      <div
        className={classes.sidebarContent}
        style={{
          opacity: sidebarOpen ? 1 : 0,
        }}
      >
        {showNotifications ? (
          <>
            <div className={classes.notificationHeader}>
              <div className={classes.canyonHeader}>
                <button
                  className={classes.backButton}
                  onClick={() => setShowNotifications(false)}
                >
                  <img
                    className={`${classes.arrow} icon`}
                    src={Arrow}
                    alt="Arrow"
                  />
                </button>
                <h2 style={{ marginLeft: "0.5em" }}>Notifications</h2>
              </div>
              <button
                className={classes.addFriendButton}
                onClick={async () => {
                  await markAllNotificationsRead();
                  onRefetchNotifications();
                }}
              >
                Mark all read
              </button>
            </div>
            <span className={classes.separator} />
            <div className={classes.notificationList}>
              {notifications.length === 0 ? (
                <Typography
                  variant="caption"
                  sx={{ opacity: 0.6, padding: "0.5em 0" }}
                >
                  No notifications.
                </Typography>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`${classes.notificationItem} ${!n.read ? classes.notificationUnread : ""}`}
                    onClick={async () => {
                      if (!n.read) {
                        await markNotificationRead(n.id);
                        onRefetchNotifications();
                      }
                      if (n.type === "canyon_shared" && n.payload.canyonId) {
                        setShowNotifications(false);
                        setSelectedCanyonID(n.payload.canyonId as string);
                      }
                    }}
                  >
                    <div className={classes.notificationText}>
                      {n.type === "friend_request" &&
                        `${n.payload.requesterUsername} sent you a friend request`}
                      {n.type === "friend_request_accepted" &&
                        `${n.payload.acceptedByUsername} accepted your friend request`}
                      {n.type === "canyon_shared" &&
                        `${n.payload.sharedByUsername} shared ${n.payload.canyonName} with you`}
                    </div>
                    <div className={classes.notificationTime}>
                      {new Date(n.createdAt).toLocaleDateString()}
                    </div>
                    {n.type === "friend_request" && (
                      <div className={classes.notificationActions}>
                        <button
                          className={classes.acceptButton}
                          onClick={async (e) => {
                            e.stopPropagation();
                            await acceptFriendRequest(
                              n.payload.friendshipId as string,
                            );
                            onRefetchFriends();
                            onRefetchNotifications();
                          }}
                        >
                          Accept
                        </button>
                        <button
                          className={classes.declineButton}
                          onClick={async (e) => {
                            e.stopPropagation();
                            await declineFriendRequest(
                              n.payload.friendshipId as string,
                            );
                            onRefetchFriends();
                            onRefetchNotifications();
                          }}
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            {notifications.some((n) => n.read) && (
              <button
                className={classes.clearAllButton}
                onClick={async () => {
                  await clearReadNotifications();
                  onRefetchNotifications();
                }}
              >
                Clear read notifications
              </button>
            )}
          </>
        ) : selectedCanyonID != null ? (
          <div className={classes.canyonHeader}>
            <button
              className={classes.backButton}
              onClick={() => setSelectedCanyonID(null)}
            >
              <img
                className={`${classes.arrow} icon`}
                src={Arrow}
                alt="Arrow"
              />
            </button>
            <h2 style={{ marginLeft: "0.5em" }}>{canyon?.name}</h2>
          </div>
        ) : (
          <div
            className={classes.canyonHeader}
            style={{ justifyContent: "space-between" }}
          >
            <h2>Sidebar</h2>
            <button
              className={classes.notificationBell}
              onClick={() => {
                setShowNotifications(true);
                onRefetchNotifications();
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadCount > 0 && (
                <span className={classes.bellBadge}>{unreadCount}</span>
              )}
            </button>
          </div>
        )}

        {!showNotifications && (
          <>
            <span className={classes.separator} />
            {selectedCanyonID == null ? sidebarModules() : canyonInfo()}
          </>
        )}
      </div>
      <button
        className={classes.toggleButton}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <img
          className={`${classes.arrow} icon`}
          src={Arrow}
          alt="Arrow"
          style={{
            transform: sidebarOpen ? "rotate(0deg)" : "rotate(180deg)",
            transition: "transform 0.3s",
          }}
        />
      </button>

      {/* Edit canyon dialog */}
      {canyon && (
        <CanyonDialog
          canyon={canyon}
          open={showEdit && !pickingCoords}
          onClose={() => setShowEdit(false)}
          onSaved={onRefetch}
          onPickCoords={onPickCoords}
          onCancelPickCoords={onCancelPickCoords}
        />
      )}

      {/* Add canyon dialog */}
      <CanyonDialog
        canyon={null}
        open={showAdd && !pickingCoords}
        onClose={() => setShowAdd(false)}
        onSaved={onRefetch}
        onPickCoords={onPickCoords}
        onCancelPickCoords={onCancelPickCoords}
      />

      {/* Delete confirmation */}
      {canyon && (
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
      )}

      {/* Remove friend confirmation */}
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

      {/* Bulk area selection dialog */}
      <Dialog
        open={selectedAreaCanyonIds.length > 0}
        onClose={bulkSharing || bulkDeleting ? undefined : onClearAreaSelection}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: "var(--sandstone-dark)",
            color: "var(--content-color)",
          },
        }}
      >
        <DialogTitle>
          Selected Canyons ({selectedAreaCanyons.length})
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            {selectedAreaCanyons.map((c) => (
              <Typography key={c.id} variant="body2" sx={{ py: 0.2 }}>
                {c.name}
                {!ownedCanyonIds.has(c.id) && (
                  <span style={{ opacity: 0.5, marginLeft: "0.5em" }}>
                    (shared)
                  </span>
                )}
              </Typography>
            ))}
          </Box>

          {ownedAreaCanyons.length > 0 && (
            <>
              <Typography variant="body2" sx={{ fontWeight: "bold", mb: 0.5 }}>
                Share {ownedAreaCanyons.length} owned canyon
                {ownedAreaCanyons.length !== 1 ? "s" : ""} with:
              </Typography>
              <TextField
                placeholder="Search friends..."
                value={bulkShareSearch}
                onChange={(e) => setBulkShareSearch(e.target.value)}
                size="small"
                fullWidth
                sx={{
                  mb: 0.5,
                  "& .MuiInputBase-input": { fontSize: "0.85em" },
                }}
              />
              {bulkShareSearch.length > 0 && (
                <Box sx={{ mb: 0.5 }}>
                  {friends
                    .filter(
                      (f) =>
                        f.username
                          .toLowerCase()
                          .includes(bulkShareSearch.toLowerCase()) &&
                        !bulkShareFriendIds.includes(f.id),
                    )
                    .map((friend) => (
                      <div key={friend.id} className={classes.searchResultItem}>
                        <span>{friend.username}</span>
                        <button
                          className={classes.addFriendButton}
                          onClick={() => {
                            setBulkShareFriendIds([
                              ...bulkShareFriendIds,
                              friend.id,
                            ]);
                            setBulkShareSearch("");
                          }}
                        >
                          Add
                        </button>
                      </div>
                    ))}
                </Box>
              )}
              {bulkShareFriendIds.length > 0 && (
                <div className={classes.selectedFriends}>
                  {bulkShareFriendIds.map((id) => {
                    const f = friends.find((fr) => fr.id === id);
                    if (!f) return null;
                    return (
                      <span key={id} className={classes.friendChip}>
                        {f.username}
                        <button
                          className={classes.chipRemove}
                          onClick={() =>
                            setBulkShareFriendIds(
                              bulkShareFriendIds.filter((fid) => fid !== id),
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
              <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleBulkShare}
                  disabled={bulkSharing || bulkShareFriendIds.length === 0}
                >
                  {bulkSharing ? "Sharing..." : "Share Selected"}
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  size="small"
                  onClick={() => setShowBulkDeleteConfirm(true)}
                  disabled={bulkDeleting}
                >
                  Delete Selected
                </Button>
              </Box>
            </>
          )}
          {ownedAreaCanyons.length === 0 && (
            <Typography variant="body2" sx={{ opacity: 0.6 }}>
              No owned canyons in selection. Bulk actions only apply to your own
              canyons.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={onClearAreaSelection}
            disabled={bulkSharing || bulkDeleting}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk delete confirmation */}
      <Dialog
        open={showBulkDeleteConfirm}
        onClose={
          bulkDeleting ? undefined : () => setShowBulkDeleteConfirm(false)
        }
      >
        <DialogTitle>
          Delete {ownedAreaCanyons.length} Canyon
          {ownedAreaCanyons.length !== 1 ? "s" : ""}?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete {ownedAreaCanyons.length} canyon
            {ownedAreaCanyons.length !== 1 ? "s" : ""} and all associated trip
            logs. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowBulkDeleteConfirm(false)}
            disabled={bulkDeleting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleBulkDelete}
            color="error"
            variant="contained"
            disabled={bulkDeleting}
          >
            {bulkDeleting ? "Deleting..." : "Delete All"}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

export default Sidebar;
