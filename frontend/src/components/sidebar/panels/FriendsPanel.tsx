// Friends — "who can I share a place with, and who is waiting on me?"
//
// The page answers with a count and owns the one acquisition action: Add, which
// opens the username search in a dialog rather than sitting above the list. The
// old panel led with that search box, so the first thing on the page was a way
// to look for people who are not on it (DESIGN.md §1, and Logjam GPS's
// FriendsScreen, which settled this shape).
//
// One pinned rail partitions All / Friends / Requests — a true partition,
// because a pending request is not a friendship yet — over one flat list.
//
// A friend's row OPENS their sharing audit, and its ⋯ ACTS (§7): the audit is
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
import { useEffect, useRef, useState } from "react";
import { EllipsisVertical, Share2, UserMinus, UserPlus, Users } from "lucide-react";
import classes from "./FriendsPanel.module.css";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import FriendSharingSection from "./FriendSharingSection";
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
  Menu,
  Row,
  SearchField,
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

type Bucket = "all" | "friends" | "requests";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

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

  async function runAction(id: string, action: () => Promise<unknown>, failure: string, success?: string) {
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

  async function handleRemove(friend: TFriend) {
    await runAction(
      friend.friendshipId,
      () => removeFriend(friend.friendshipId),
      "Couldn't remove friend.",
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
    { value: "all", label: "All", count: friends.length + friendRequests.length },
    { value: "friends", label: "Friends", count: friends.length, disabled: friends.length === 0 },
    {
      value: "requests",
      label: "Requests",
      count: friendRequests.length,
      hue: "var(--hue-shared)",
      disabled: friendRequests.length === 0,
    },
  ];

  // Requests first in All: they are the only rows that need a decision.
  const showRequests = bucket !== "friends";
  const showFriends = bucket !== "requests";

  return (
    <div className={classes.root}>
      {/* A request outranks the count: it is the only thing on this page that
          is waiting on you. Otherwise the title is the count of FRIENDS, not of
          rows — a request is not one yet. */}
      <Hero
        title={
          friendRequests.length > 0
            ? plural(friendRequests.length, "request")
            : friends.length === 0
              ? "No friends yet"
              : plural(friends.length, "friend")
        }
        actions={
          <Button compact variant="outline" icon={UserPlus} onClick={() => setAddOpen(true)}>
            Add
          </Button>
        }
      />

      <div className={classes.rails}>
        <ChipRail label="Which people" options={buckets} value={bucket} onChange={setBucket} />
      </div>

      {friends.length === 0 && friendRequests.length === 0 ? (
        <div className={classes.emptyArea}>
          <EmptyState
            icon={Users}
            title="No friends yet"
            body="Friends are who you can share a place, a route or a map with. Find one by their username."
            actions={
              <Button variant="filled" icon={UserPlus} onClick={() => setAddOpen(true)}>
                Add a friend
              </Button>
            }
          />
        </div>
      ) : (
        <div className={classes.list}>
          {showRequests &&
            friendRequests.map((request) => (
              <Row
                key={request.id}
                leading={<Avatar username={request.requester.username} />}
                title={request.requester.username}
                subtitle="Wants to be friends"
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
                          "Couldn't accept friend request.",
                          `${request.requester.username} is now a friend.`,
                        ).then(onRefetchNotifications)
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      compact
                      variant="outline"
                      disabled={busyId === request.id}
                      onClick={() =>
                        void runAction(
                          request.id,
                          () => declineFriendRequest(request.id),
                          "Couldn't decline friend request.",
                          "Request declined.",
                        )
                      }
                    >
                      Decline
                    </Button>
                  </>
                }
              />
            ))}

          {showFriends &&
            friends.map((friend) => (
              <Row
                key={friend.friendshipId}
                leading={<Avatar username={friend.username} />}
                title={friend.username}
                description="Opens what you share with each other"
                disabled={busyId === friend.friendshipId}
                onOpen={() => setOpenFriend(friend)}
                trailing={
                  <Menu
                    label={`Actions for ${friend.username}`}
                    title={friend.username}
                    placement="bottom-end"
                    entries={[
                      {
                        id: "shares",
                        label: "Shared items",
                        icon: Share2,
                        onSelect: () => setOpenFriend(friend),
                      },
                      {
                        id: "remove",
                        label: "Remove friend",
                        icon: UserMinus,
                        danger: true,
                        onSelect: () => setRemoving(friend),
                      },
                    ]}
                    trigger={(props) => (
                      <IconButton
                        {...props}
                        icon={EllipsisVertical}
                        label={`Actions for ${friend.username}`}
                      />
                    )}
                  />
                }
              />
            ))}
        </div>
      )}

      <AddFriendDialog
        open={addOpen}
        friends={friends}
        onClose={() => setAddOpen(false)}
        onSent={onRefetchFriends}
      />

      <ConfirmDialog
        open={removing != null}
        title={removing ? `Remove ${removing.username}?` : ""}
        message={
          removing
            ? `Everything you share with each other stops being shared, both ways. You can send ${removing.username} a friend request again later, and sharing does not come back with it.`
            : null
        }
        confirmLabel="Remove"
        busy={busyId != null}
        onConfirm={() => removing && void handleRemove(removing)}
        onClose={() => setRemoving(null)}
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

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSentIds(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < SEARCH_MIN_CHARS) {
      setResults([]);
      return;
    }
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
          toast.error(messageFromError(err, "Couldn't search users."));
        });
    }, 300);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open, query, toast]);

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
      toast.error(messageFromError(err, "Couldn't send friend request."));
    } finally {
      setSendingId(null);
    }
  }

  const friendIds = new Set(friends.map((friend) => friend.id));
  const typed = query.trim();

  return (
    <Dialog
      open={open}
      title="Add a friend"
      onClose={onClose}
      dismissible={sendingId === null}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className={classes.addBody}>
        <SearchField
          label="Search by username"
          placeholder="Search by username"
          value={query}
          data-autofocus
          onChange={(event) => setQuery(event.target.value)}
        />
        {typed.length < SEARCH_MIN_CHARS ? (
          <p className={classes.note}>
            Keep typing — at least {SEARCH_MIN_CHARS} characters.
          </p>
        ) : results.length === 0 ? (
          <p className={classes.note}>No one by that name.</p>
        ) : (
          results.map((user) => (
            <Row
              key={user.id}
              leading={<Avatar username={user.username} />}
              title={user.username}
              trailing={
                friendIds.has(user.id) ? (
                  <StatusPill label="Friend" tone="muted" />
                ) : sentIds.has(user.id) ? (
                  <StatusPill label="Requested" tone="outline" />
                ) : (
                  <Button
                    compact
                    variant="outline"
                    busy={sendingId === user.id}
                    disabled={sendingId !== null}
                    onClick={() => void handleSend(user)}
                  >
                    Add
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
