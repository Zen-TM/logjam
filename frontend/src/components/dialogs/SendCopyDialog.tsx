// The friend-picker for SENDING A COPY — a file handed over for keeps.
//
// NOT ShareDialog, and deliberately unlike it: a share is revocable, so a press
// there grants at once; a copy cannot be taken back, so here a press only
// ticks a friend and nothing leaves until the Send button. Logjam GPS draws
// the same line in `SharePanel.tsx` (ADR 0016), and the promise below is its
// sentence, word for word.
//
// PRIVACY: usernames only, never email (root AGENTS.md).
import { useState } from "react";
import { friendMatches } from "@logjam/shared";
import classes from "./SendCopyDialog.module.css";
import { messageFromError } from "../../errors/messageFromError";
import type { TFriend } from "../../placeUtils";
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  SearchField,
  Icon,
  ErrorBanner,
} from "../../ui";

/** The list stays searchable only once it is long enough to need it. */
const SEARCH_FROM = 8;

function SendCopyDialog({
  title,
  friends,
  open,
  onClose,
  send,
}: {
  title: string;
  friends: TFriend[];
  open: boolean;
  onClose: () => void;
  /** Resolves once the send is recorded; a throw keeps the dialog open and
   *  says why. */
  send: (recipientIds: string[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each open starts with nobody ticked: a copy goes only where it was sent
  // THIS time, never to whoever was ticked the last time the dialog was open.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPicked(new Set());
      setQuery("");
      setError(null);
    }
  }

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleSend = async () => {
    setBusy(true);
    setError(null);
    try {
      await send([...picked]);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't send the copy."));
    } finally {
      setBusy(false);
    }
  };

  const searchable = friends.length >= SEARCH_FROM;
  const shown = searchable
    ? friends.filter((friend) => friendMatches(friend.username, query))
    : friends;

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {friends.length > 0 && (
            <Button
              variant="filled"
              onClick={() => void handleSend()}
              disabled={busy || picked.size === 0}
            >
              {picked.size > 1 ? `Send ${picked.size} copies` : "Send a copy"}
            </Button>
          )}
        </>
      }
    >
      {friends.length === 0 ? (
        <EmptyState
          icon="friends"
          title="No friends yet"
          body="Copies go to friends. Add one on the Friends page, then come back."
        />
      ) : (
        <div className={classes.body}>
          {error && <ErrorBanner message={error} />}
          <p className={classes.promise}>
            <Icon
              idea="warning"
              size={16}
              aria-hidden
              className={classes.glyph}
            />
            They'll keep their own copy — you can't take it back.
          </p>
          {searchable && (
            <SearchField
              label="Search friends"
              placeholder="Search friends"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          {shown.length === 0 ? (
            <p className={classes.note}>No friends match “{query.trim()}”.</p>
          ) : (
            shown.map((friend) => (
              <Checkbox
                key={friend.id}
                label={friend.username}
                checked={picked.has(friend.id)}
                disabled={busy}
                onChange={(on) => toggle(friend.id, on)}
              />
            ))
          )}
        </div>
      )}
    </Dialog>
  );
}

export default SendCopyDialog;
