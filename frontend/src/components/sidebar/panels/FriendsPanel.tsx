// Friends — "who can I share a place with, and who is waiting on me?"
//
// The page answers with a count and owns the one acquisition action: Add, which
// opens the username search in a dialog rather than sitting above the list. The
// old panel led with that search box, so the first thing on the page was a way
// to look for people who are not on it (docs/ux-principles.md §2, and Logjam GPS's
// FriendsScreen, which settled this shape).
//
// One pinned rail partitions All / Friends / Requests — a true partition,
// because a pending request is not a friendship yet — over one flat list.
//
// A friend's row OPENS their sharing audit, and its ⋯ ACTS (DESIGN.md §5): the audit is
// read-only, so a mis-tap there costs nothing, while Remove friend stays behind
// the menu. A request has nowhere to open to, so it carries Accept and Decline
// on the card's own footer line.
//
// FILES SENT TO YOU used to have a section here as well. They are the Inbox's,
// and always were — every send writes the recipient a notification and both
// verbs resolve it (api/src/routes/fileSends.ts) — so this page held a second,
// separately-fetched copy of a list the Inbox draws better.
//
// PRIVACY: usernames only, everywhere. `/friends`, `/friends/requests` and
// `/friends/search` never return an email (root CLAUDE.md), and nothing here
// would have somewhere to put one.
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  contractSectionKeys,
  FRIENDS,
  friendAcceptedMessage,
  friendRemovedMessage,
  friendsRemovedMessage,
  friendsRemoveConfirm,
  friendRemoveConfirm,
  friendsEmptyKind,
  friendVerb,
  type FriendsBucket,
  type SectionKeysOn,
} from "@logjam/shared";
import classes from "./FriendsPanel.module.css";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import FriendSharingSection from "./FriendSharingSection";
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
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
} from "../../../placeUtils";

/** Shorter than this and the server has nothing useful to match on. */
const SEARCH_MIN_CHARS = 3;

type Bucket = FriendsBucket;

const copy = FRIENDS.copy;

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
  const toast = useToast();
  const [bucket, setBucket] = useState<Bucket>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TFriend | null>(null);
  const [removingSelected, setRemovingSelected] = useState(false);
  // Non-null = the sharing audit for that friend replaces the list: at 380px
  // there is no room for both, and the audit is a page you go and read.
  const [openFriend, setOpenFriend] = useState<TFriend | null>(null);

  // Refetch on every panel open — friends and requests are otherwise fetched
  // once at app boot (FRIEND-3), so a request that arrives mid-session stays
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

  // Exhaustive by type: a section the contract names and this panel does not
  // draw, or the reverse, fails `tsc` (`FRIENDS`, shared/src/contracts).
  const page: Record<SectionKeysOn<typeof FRIENDS, "web">, () => ReactNode> = {
    hero: () => (
      <Hero
        title={FRIENDS.title}
        actions={
          <Button
            compact
            variant="outline"
            icon="addFriend"
            onClick={() => setAddOpen(true)}
          >
            {copy.add}
          </Button>
        }
      />
    ),
    buckets: () => (
      // The selection bar takes the rail's slot at the rail's height, so the
      // list does not move when a selection starts (DESIGN.md §5).
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
                        disabled={busyId === request.id}
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
 *  stays and the error arrives as a toast. */
function AddFriendDialog({
  open,
  friends,
  onClose,
  onSent,
}: {
  open: boolean;
  friends: TFriend[];
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TSearchUser[]>([]);
  const [sentIds, setSentIds] = useState<ReadonlySet<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Closing clears the search, during render.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setResults([]);
      setSentIds(new Set());
    }
  }

  // Too short a query (or a closed dialog) shows no results, also during
  // render; the effect's cleanup drops any response still on its way.
  const searches = open && query.trim().length >= SEARCH_MIN_CHARS;
  if (!searches && results.length > 0) setResults([]);

  useEffect(() => {
    if (!searches) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    // FEUI-008: guards a stale response landing after a newer query's already
    // replaced it (type "abel" then "abelin" — if "abel"'s GET resolves last,
    // its results must not overwrite "abelin"'s). `searchUsers`/`apiFetch` take
    // no signal, so this is the cancelled-flag form of the same guard.
    let cancelled = false;
    timerRef.current = setTimeout(() => {
      searchUsers(query.trim())
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(err);
          toast.error(messageFromError(err, copy.searchFailed));
        });
    }, 300);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [searches, query, toast]);

  async function handleSend(user: TSearchUser) {
    setSendingId(user.id);
    try {
      await sendFriendRequest(user.id);
      // Mark the row rather than dropping it: a search with several matches can
      // keep going, and the pill is what says the request went.
      setSentIds((prev) => new Set(prev).add(user.id));
      onSent();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.sendFailed));
    } finally {
      setSendingId(null);
    }
  }

  const friendIds = new Set(friends.map((friend) => friend.id));
  const typed = query.trim();

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
        {typed.length < SEARCH_MIN_CHARS ? (
          <p className={classes.note}>{copy.searchHint}</p>
        ) : results.length === 0 ? (
          <p className={classes.note}>{copy.searchEmpty}</p>
        ) : (
          results.map((user) => (
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
                    onClick={() => void handleSend(user)}
                  >
                    {copy.add}
                  </Button>
                )
              }
            />
          ))
        )}
      </div>
    </Dialog>
  );
}

export default FriendsPanel;
