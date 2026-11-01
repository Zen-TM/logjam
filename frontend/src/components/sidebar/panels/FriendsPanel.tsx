// Friends — "who can I share a place with, and who is waiting on me?"
//
// The page answers with a count and owns the one acquisition action: Add, which
// opens the username search in a dialog rather than sitting above the list: the
// first thing on the page would otherwise be a way to look for people who are
// not on it (shared/DESIGN.md §2, and Logjam GPS's FriendsScreen, which settled
// this shape).
//
// One pinned rail partitions All / Friends / Requests — a true partition,
// because a pending request is not a friendship yet — over one flat list.
//
// A friend's row OPENS their sharing audit, and its ⋯ ACTS (DESIGN.md): the audit is
// read-only, so a mis-tap there costs nothing, while Remove friend stays behind
// the menu. A request has nowhere to open to, so it carries Accept and Decline
// on the card's own footer line.
//
// Files sent to you belong in the Inbox (api/src/routes/fileSends.ts): every
// send writes the recipient a notification and both verbs resolve it,
// avoiding a second, separately-fetched copy of a list the Inbox draws better.
//
// The leaderboard button is drawn only for someone who has joined it: for anyone
// else nothing here mentions it, and the way in is the switch in Settings
// (contracts/leaderboard.ts; FriendsPanel.render.test.tsx).
//
// PRIVACY: usernames only, everywhere. `/friends`, `/friends/requests` and
// `/friends/search` never return an email (api/src/__tests__/friends.test.ts), and nothing here
// would have somewhere to put one.
import { useUserSearch } from "../../../useUserSearch";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  contractSectionKeys,
  FRIENDS,
  friendAcceptedMessage,
  friendInviteUrl,
  friendInvitesLiveLabel,
  friendRemovedMessage,
  friendRequestMadeFriend,
  friendsRemovedMessage,
  friendsRemoveConfirm,
  friendRemoveConfirm,
  friendsEmptyKind,
  friendVerb,
  type FriendsBucket,
  type SectionKeysOn,
  friendSearchHint,
  LEADERBOARD,
  leaderboardBadge,
  leaderboardButtonLabel,
  selfStanding,
  type LeaderboardResponse,
} from "@logjam/shared";
import classes from "./FriendsPanel.module.css";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import FriendSharingSection from "./FriendSharingSection";
import LeaderboardPage from "./LeaderboardPage";
import { useRowSelection } from "./useRowSelection";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import {
  Avatar,
  Button,
  ChipRail,
  Dialog,
  EmptyState,
  Hero,
  IconButton,
  ListEnd,
  Menu,
  Row,
  SearchField,
  SelectionBar,
  TileCheckbox,
  StatusPill,
  type ChipOption,
} from "../../../ui";
import type { TFriend, TFriendRequest, TSearchUser } from "../../../placeUtils";
import {
  createFriendInvite,
  getFriendInvites,
  revokeFriendInvites,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  getLeaderboard,
} from "../../../placeUtils";

type Bucket = FriendsBucket;

const copy = FRIENDS.copy;

function FriendsPanel({
  leaderboardOptIn,
  friends,
  friendRequests,
  onRefetchFriends,
  onRefetchShared,
  onRefetchNotifications,
}: {
  leaderboardOptIn: boolean;
  friends: TFriend[];
  friendRequests: TFriendRequest[];
  onRefetchFriends: () => void;
  onRefetchShared: () => void;
  onRefetchNotifications: () => void;
}) {
  const toast = useToast();
  const [bucket, setBucket] = useState<Bucket>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TFriend | null>(null);
  const [removingSelected, setRemovingSelected] = useState(false);
  // Non-null = the sharing audit for that friend replaces the list: at 380px
  // there is no room for both, and the audit is a page you go and read.
  const [openFriend, setOpenFriend] = useState<TFriend | null>(null);
  // The same, for the leaderboard. Its board is fetched here, so the row's
  // subtitle and the page read one answer.
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);

  const fetchBoard = useCallback(() => {
    getLeaderboard()
      .then((next) => {
        setBoard(next);
        setBoardError(null);
      })
      .catch((err) => {
        console.error(err);
        setBoardError(messageFromError(err, LEADERBOARD.copy.loadFailed));
      });
  }, []);

  useEffect(() => {
    if (leaderboardOptIn) fetchBoard();
  }, [leaderboardOptIn, fetchBoard]);

  /** A reload the user asked for: Try again, or opening the page. */
  const loadBoard = () => {
    setBoardError(null);
    fetchBoard();
  };

  // Refetch on every panel open — friends and requests are otherwise fetched
  // once at app boot, so a request that arrives mid-session stays
  // invisible until a full reload.
  useEffect(() => {
    onRefetchFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAction(
    id: string,
    action: () => Promise<unknown>,
    failure: string,
    success?: string,
  ) {
    setBusyId(id);
    try {
      await action();
      if (success) toast.success(success);
      onRefetchFriends();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, failure));
    } finally {
      setBusyId(null);
    }
  }

  // Friends, not requests, are what a selection can hold: Remove is the one
  // bulk verb, and a request has Accept / Decline of its own.
  const friendIds = useMemo(
    () =>
      bucket === "requests" ? [] : friends.map((friend) => friend.friendshipId),
    [bucket, friends],
  );
  const { rootRef, selectedIds, selecting, toggle, clear } =
    useRowSelection(friendIds);
  const selectedFriends = friends.filter((friend) =>
    selectedIds.includes(friend.friendshipId),
  );

  async function handleRemoveSelected() {
    setBusyId("selection");
    let removed = 0;
    try {
      // One request per friend: a selection is a handful, and a failure halfway
      // leaves the ones already removed removed and says so.
      for (const friend of selectedFriends) {
        await removeFriend(friend.friendshipId);
        removed += 1;
      }
      toast.success(friendsRemovedMessage(removed));
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.removeFailed));
    } finally {
      setBusyId(null);
      setRemovingSelected(false);
      clear();
      onRefetchFriends();
      onRefetchShared();
    }
  }

  async function handleRemove(friend: TFriend) {
    await runAction(
      friend.friendshipId,
      () => removeFriend(friend.friendshipId),
      copy.removeFailed,
      friendRemovedMessage(friend.username),
    );
    setRemoving(null);
    onRefetchShared();
  }

  if (leaderboardOpen && leaderboardOptIn) {
    return (
      <LeaderboardPage
        board={board}
        error={boardError}
        onRetry={loadBoard}
        onBack={() => setLeaderboardOpen(false)}
      />
    );
  }

  if (openFriend) {
    return (
      <FriendSharingSection
        friend={openFriend}
        onBack={() => setOpenFriend(null)}
        onSharesChanged={onRefetchShared}
      />
    );
  }

  const buckets: ChipOption<Bucket>[] = [
    {
      value: "all",
      label: copy.bucketAll,
      count: friends.length + friendRequests.length,
    },
    {
      value: "friends",
      label: copy.bucketFriends,
      count: friends.length,
      disabled: friends.length === 0,
    },
    {
      value: "requests",
      label: copy.bucketRequests,
      count: friendRequests.length,
      hue: "var(--hue-shared)",
      disabled: friendRequests.length === 0,
    },
  ];

  // Requests first in All: they are the only rows that need a decision.
  const showRequests = bucket !== "friends";
  const showFriends = bucket !== "requests";

  // The same button is the empty state's and the end of the list's.
  const addFriendButton = (
    <Button variant="filled" icon="addFriend" onClick={() => setAddOpen(true)}>
      {copy.addTitle}
    </Button>
  );

  const emptyKind = friendsEmptyKind({
    friends: friends.length,
    requests: friendRequests.length,
    bucket,
  });

  function leaderboardButton() {
    // `false` from the server outranks the cached preference: the user left
    // on another device since this session fetched it.
    if (!leaderboardOptIn || board?.joined === false) return null;
    const standing = board?.joined ? selfStanding(board) : null;
    return (
      <IconButton
        icon="leaderboard"
        label={leaderboardButtonLabel(standing)}
        badge={standing && leaderboardBadge(standing.rank, standing.size)}
        onClick={() => {
          loadBoard();
          setLeaderboardOpen(true);
        }}
      />
    );
  }

  // Exhaustive by type: a section the contract names and this panel does not
  // draw, or the reverse, fails `tsc` (`FRIENDS`, shared/src/contracts).
  const page: Record<SectionKeysOn<typeof FRIENDS, "web">, () => ReactNode> = {
    hero: () => (
      <Hero
        title={FRIENDS.title}
        actions={
          <>
            {leaderboardButton()}
            <Button
              compact
              variant="outline"
              icon="addFriend"
              onClick={() => setAddOpen(true)}
            >
              {copy.add}
            </Button>
          </>
        }
      />
    ),
    buckets: () => (
      // The selection bar takes the rail's slot at the rail's height, so the
      // list does not move when a selection starts (DESIGN.md).
      <div className={classes.rails}>
        {selecting ? (
          <SelectionBar
            countLabel={`${selectedFriends.length} selected`}
            onClear={clear}
          >
            <IconButton
              icon={friendVerb("remove").icon}
              label={friendVerb("remove").label}
              tone="danger"
              onClick={() => setRemovingSelected(true)}
            />
          </SelectionBar>
        ) : (
          <ChipRail
            label="Which people"
            options={buckets}
            value={bucket}
            onChange={setBucket}
          />
        )}
      </div>
    ),
    list: () => (
      <>
        {emptyKind === "firstRun" ? (
          <div className={classes.emptyArea}>
            <EmptyState
              icon="friends"
              title={copy.firstRunTitle}
              body={copy.firstRunBody}
              actions={addFriendButton}
            />
          </div>
        ) : emptyKind === "noRequests" ? (
          <div className={classes.emptyArea}>
            <EmptyState icon="friends" title={copy.noRequestsTitle} />
          </div>
        ) : (
          <div className={classes.list}>
            {showRequests &&
              friendRequests.map((request) => (
                <Row
                  key={request.id}
                  leading={<Avatar username={request.requester.username} />}
                  title={request.requester.username}
                  subtitle={copy.requestSubtitle}
                  disabled={busyId === request.id}
                  accentEdge
                  footer={
                    <>
                      <Button
                        compact
                        variant="filled"
                        busy={busyId === request.id}
                        onClick={() =>
                          void runAction(
                            request.id,
                            () => acceptFriendRequest(request.id),
                            copy.acceptFailed,
                            friendAcceptedMessage(request.requester.username),
                          ).then(onRefetchNotifications)
                        }
                      >
                        {friendVerb("accept").label}
                      </Button>
                      <Button
                        compact
                        variant="outline"
                        disabled={busyId === request.id}
                        disabledReason="Replying…"
                        onClick={() =>
                          void runAction(
                            request.id,
                            () => declineFriendRequest(request.id),
                            copy.declineFailed,
                            copy.declined,
                          )
                        }
                      >
                        {friendVerb("decline").label}
                      </Button>
                    </>
                  }
                />
              ))}

            {showFriends &&
              friends.map((friend) => (
                <Row
                  key={friend.friendshipId}
                  leading={
                    <TileCheckbox
                      tile={<Avatar username={friend.username} />}
                      label={`Select ${friend.username}`}
                      checked={selectedIds.includes(friend.friendshipId)}
                      selecting={selecting}
                      onToggle={(extendRange) =>
                        toggle(friend.friendshipId, extendRange)
                      }
                    />
                  }
                  selected={selectedIds.includes(friend.friendshipId)}
                  title={friend.username}
                  description="Opens what you share with each other"
                  disabled={busyId === friend.friendshipId}
                  onOpen={() => setOpenFriend(friend)}
                  trailing={
                    selecting ? undefined : (
                      <Menu
                        label={`Actions for ${friend.username}`}
                        title={friend.username}
                        placement="bottom-end"
                        entries={[
                          {
                            id: "shares",
                            label: friendVerb("shares").label,
                            icon: "shareFriend",
                            onSelect: () => setOpenFriend(friend),
                          },
                          {
                            id: "remove",
                            label: friendVerb("remove").label,
                            icon: "unshare",
                            danger: true,
                            onSelect: () => setRemoving(friend),
                          },
                        ]}
                        trigger={(props) => (
                          <IconButton
                            {...props}
                            icon="overflow"
                            label={`Actions for ${friend.username}`}
                          />
                        )}
                      />
                    )
                  }
                />
              ))}
            <ListEnd>{addFriendButton}</ListEnd>
          </div>
        )}
      </>
    ),
  };

  return (
    <div ref={rootRef} className={classes.root}>
      {contractSectionKeys(FRIENDS, "web").map((key) => (
        <Fragment key={key}>{page[key]()}</Fragment>
      ))}

      <AddFriendDialog
        open={addOpen}
        friends={friends}
        onClose={() => setAddOpen(false)}
        onSent={onRefetchFriends}
        onFriended={onRefetchNotifications}
      />

      <ConfirmDialog
        open={removing != null}
        title={
          removing ? friendRemoveConfirm(removing.username).confirmTitle : ""
        }
        message={
          removing ? friendRemoveConfirm(removing.username).confirmBody : null
        }
        confirmLabel="Remove"
        busy={busyId != null}
        onConfirm={() => removing && void handleRemove(removing)}
        onClose={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={removingSelected}
        title={friendsRemoveConfirm(selectedFriends.length).confirmTitle}
        message={friendsRemoveConfirm(selectedFriends.length).confirmBody}
        confirmLabel="Remove"
        busy={busyId != null}
        onConfirm={() => void handleRemoveSelected()}
        onClose={() => setRemovingSelected(false)}
      />
    </div>
  );
}

/** Username search → friend request. Already-a-friend and already-pending are
 *  refused server-side with a 409 whose message is worth showing, so the row
 *  stays and the error arrives as a toast. A request to someone who had
 *  already asked makes a friend there and then: `onFriended`, because their
 *  request's prompt has just left the inbox.
 *  Exported for FriendsPanel.render.test.tsx. */
export function AddFriendDialog({
  open,
  friends,
  onClose,
  onSent,
  onFriended,
}: {
  open: boolean;
  friends: TFriend[];
  onClose: () => void;
  onSent: () => void;
  onFriended: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const { short, results, total } = useUserSearch(
    query,
    open,
    copy.searchFailed,
  );
  const [sentIds, setSentIds] = useState<ReadonlySet<string>>(new Set());
  // Made a friend by sending, shown until the refetched list says so itself.
  const [friendedIds, setFriendedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [sendingId, setSendingId] = useState<string | null>(null);

  // Closing clears the search, during render.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setSentIds(new Set());
      setFriendedIds(new Set());
    }
  }

  async function handleSend(user: TSearchUser) {
    setSendingId(user.id);
    try {
      const friended = friendRequestMadeFriend(
        await sendFriendRequest(user.id),
      );
      // Mark the row rather than dropping it: a search with several matches can
      // keep going, and the pill is what says the request went.
      (friended ? setFriendedIds : setSentIds)((prev) =>
        new Set(prev).add(user.id),
      );
      if (friended) {
        toast.success(friendAcceptedMessage(user.username));
        onFriended();
      }
      onSent();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.sendFailed));
    } finally {
      setSendingId(null);
    }
  }

  const friendIds = new Set([
    ...friends.map((friend) => friend.id),
    ...friendedIds,
  ]);

  return (
    <Dialog
      open={open}
      title={copy.addTitle}
      onClose={onClose}
      dismissible={sendingId === null}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className={classes.addBody}>
        <SearchField
          label={copy.searchField}
          placeholder={copy.searchField}
          value={query}
          data-autofocus
          onChange={(event) => setQuery(event.target.value)}
        />
        {short ? (
          <p className={classes.note}>{copy.searchHint}</p>
        ) : results.length === 0 ? (
          <p className={classes.note}>{copy.searchEmpty}</p>
        ) : (
          <>
            {results.map((user) => (
              <Row
                key={user.id}
                leading={<Avatar username={user.username} />}
                title={user.username}
                trailing={
                  friendIds.has(user.id) ? (
                    <StatusPill label={copy.pillFriend} tone="muted" />
                  ) : sentIds.has(user.id) ? (
                    <StatusPill label={copy.pillRequested} tone="outline" />
                  ) : (
                    <Button
                      compact
                      variant="outline"
                      busy={sendingId === user.id}
                      disabled={sendingId !== null}
                      disabledReason="Sending…"
                      onClick={() => void handleSend(user)}
                    >
                      {copy.add}
                    </Button>
                  )
                }
              />
            ))}
            {friendSearchHint(results.length, total) ? (
              <p className={classes.note}>
                {friendSearchHint(results.length, total)}
              </p>
            ) : null}
          </>
        )}
        <InviteLink open={open} />
      </div>
    </Dialog>
  );
}

/** The other way to add someone: a link to send, for when they are not at
 *  hand to spell a username. The link goes to the clipboard and is shown only
 *  when the browser refuses that: it exists only in this reply, so the page
 *  is then the one place left to take it from. */
export function InviteLink({ open }: { open: boolean }) {
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [live, setLive] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getFriendInvites()
      .then((invites) => {
        if (!cancelled) setLive(invites.length);
      })
      // The count is a courtesy; the buttons work without it.
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
      setLink(null);
    };
  }, [open]);

  async function handleCopy() {
    setBusy(true);
    let url: string;
    try {
      const { token } = await createFriendInvite();
      url = friendInviteUrl(window.location.origin, token);
      setLink(null);
      setLive((count) => count + 1);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.inviteFailed));
      setBusy(false);
      return;
    }
    // Its own failure: the link was made, so saying it could not be made sent
    // people back for a second one. It is put on screen to select by hand
    // (FriendsPanel.render.test.tsx).
    try {
      await navigator.clipboard.writeText(url);
      toast.success(copy.inviteCopied);
    } catch (err) {
      console.error(err);
      setLink(url);
      toast.error(copy.inviteCopyFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    try {
      await revokeFriendInvites();
      setLink(null);
      setLive(0);
      toast.success(copy.inviteRevoked);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.inviteRevokeFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={classes.invite}>
      <p className={classes.note}>{copy.inviteHint}</p>
      <Button
        variant="outline"
        icon="link"
        busy={busy}
        onClick={() => void handleCopy()}
      >
        {copy.inviteCopy}
      </Button>
      {link && <p className={classes.inviteLink}>{link}</p>}
      {live > 0 && (
        <p className={classes.note}>
          {friendInvitesLiveLabel(live)}{" "}
          <Button
            compact
            disabled={busy}
            disabledReason="Working…"
            onClick={() => void handleRevoke()}
          >
            {copy.inviteRevoke}
          </Button>
        </p>
      )}
    </div>
  );
}

export default FriendsPanel;
