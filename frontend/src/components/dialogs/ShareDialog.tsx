// The friend-picker for SHARING — a live, read-only view of something the
// owner keeps and can revoke at any time.
//
// One dialog for places and for the four direct-share types (waypoint, route,
// topoJob, geoPdfJob), because "who can see this, and take it back" is one
// interaction. The endpoints differ — places keep /places/:id/share, the rest
// use /shares — so the three calls arrive as props rather than being switched
// on a type here.
//
// NOT for "send a copy" (FileSend). That hands over a file the recipient keeps
// permanently and cannot be un-sent; wording the two alike teaches people that
// a sent file can be recalled. See shared/src/sharing.ts.
//
// PICKING A FRIEND SHARES, THERE AND THEN — no ticking, no Confirm. Logjam GPS
// draws the same distinction in `SharePanel.tsx` and says why: a share is
// revocable, so the press can be the whole action, while a copy is not and has
// to wait behind a footer button. This dialog used to make you search, press
// Add, watch a chip appear and then press Confirm Share — four presses for
// something one press can undo, and no footer button in sight for the friends
// already listed underneath.
//
// PRIVACY: usernames only, never email. The friends endpoints are
// username-only server-side (root CLAUDE.md) and this must not become the
// surface that wants more.
import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Users, X } from "lucide-react";
import { friendMatches } from "@logjam/shared";
import classes from "./ShareDialog.module.css";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import type { TFriend } from "../../placeUtils";
import {
  Avatar,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Row,
  SearchField,
  SectionHeader,
} from "../../ui";

/** Enough of a share row to list and revoke it. Both endpoints return this. */
export type ShareRecipientRow = {
  id: string;
  sharedWith: { id: string; username: string };
};

/** The list stays searchable only once it is long enough to need it. */
const SEARCH_FROM = 8;

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
  /** Dialog heading, e.g. `Share ${place.name}`. */
  title: string;
  /** What the recipient gets, in the caller's own words — a place share and a
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
  const [query, setQuery] = useState("");
  // Whose row is mid-request: that row alone shows it, and the rest stay live.
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
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

  // Best-effort: the row has already moved between the two lists optimistically
  // below, and a failed re-read is not worth a toast over a completed grant.
  const refresh = useCallback(() => {
    listShares().then(setShares).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleShare(friend: TFriend) {
    setBusyId(friend.id);
    try {
      await share(friend.id);
      // Move the row now rather than waiting for the re-read: the press was the
      // whole action, so the list it lands in is what says it worked.
      setShares((prev) => [
        ...prev,
        { id: `pending:${friend.id}`, sharedWith: { id: friend.id, username: friend.username } },
      ]);
      refresh();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't share. Please try again."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnshare(row: ShareRecipientRow) {
    setBusyId(row.sharedWith.id);
    try {
      await unshare(row.sharedWith.id);
      setShares((prev) => prev.filter((each) => each.sharedWith.id !== row.sharedWith.id));
      refresh();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't remove share. Please try again."));
    } finally {
      setBusyId(null);
    }
  }

  const sharedIds = new Set(shares.map((row) => row.sharedWith.id));
  // Someone who already has it belongs in the list above with a revoke, not in
  // the one that grants.
  const shareable = friends.filter((friend) => !sharedIds.has(friend.id));
  const searchable = friends.length >= SEARCH_FROM;
  const shown = searchable
    ? shareable.filter((friend) => friendMatches(friend.username, query))
    : shareable;
  const recipients = searchable
    ? shares.filter((row) => friendMatches(row.sharedWith.username, query))
    : shares;

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      dismissible={busyId === null}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {friends.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No friends yet"
          body="Sharing is between friends. Add one on the Friends page, then come back."
        />
      ) : (
        <div className={classes.body}>
          {/* What the press will do, before the press. */}
          <p className={classes.promise}>{blurb}</p>

          {searchable && (
            <SearchField
              label="Search friends"
              placeholder="Search friends"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}

          {recipients.length > 0 && (
            <section className={classes.group}>
              <SectionHeader title="Shared with" count={shares.length} />
              {recipients.map((row) => (
                <Row
                  key={row.id}
                  leading={<Avatar username={row.sharedWith.username} />}
                  title={row.sharedWith.username}
                  trailing={
                    <IconButton
                      icon={X}
                      label={`Stop sharing with ${row.sharedWith.username}`}
                      disabled={busyId !== null}
                      onClick={() => void handleUnshare(row)}
                    />
                  }
                />
              ))}
            </section>
          )}

          <section className={classes.group}>
            <SectionHeader title="Share with" />
            {shareable.length === 0 ? (
              <p className={classes.note}>Everyone you know already has this.</p>
            ) : shown.length === 0 ? (
              // A different dead end from the one above, and it backs out by
              // clearing the box rather than by adding a friend.
              <p className={classes.note}>No friends match “{query.trim()}”.</p>
            ) : (
              shown.map((friend) => (
                <Row
                  key={friend.id}
                  leading={<Avatar username={friend.username} />}
                  title={friend.username}
                  description="Press to share"
                  onOpen={() => void handleShare(friend)}
                  disabled={busyId !== null}
                  trailing={
                    <span className={classes.grantMark} aria-hidden>
                      {busyId === friend.id ? <Check size={16} /> : <Plus size={16} />}
                    </span>
                  }
                />
              ))
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

export default ShareDialog;
