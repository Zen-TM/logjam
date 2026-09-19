import { useId, useState } from "react";
import { deleteUser } from "aws-amplify/auth";
import { deleteAccount } from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { Button, Dialog, TextField } from "../../ui";
import classes from "./DeleteAccountDialog.module.css";

/**
 * The one irreversible thing in the app, and the only place a typed phrase
 * guards a button (DESIGN.md §7). Everything else destructive is undoable, or
 * loses one row; this ends the account, in both Cognito and our own database.
 *
 * The phrase is "delete <username>" rather than "DELETE": it cannot be typed by
 * reflex, and it names the account being ended — which matters on a browser
 * where more than one person's account may have been open.
 */
function DeleteAccountDialog({
  open,
  onClose,
  username,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  username: string;
  onDeleted: () => void;
}) {
  return open ? (
    <DeleteAccountForm onClose={onClose} username={username} onDeleted={onDeleted} />
  ) : null;
}

/** Mounted on open, so a reopened dialog starts empty rather than half-typed. */
function DeleteAccountForm({
  onClose,
  username,
  onDeleted,
}: {
  onClose: () => void;
  username: string;
  onDeleted: () => void;
}) {
  const formId = useId();
  const [confirmInput, setConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expectedPhrase = `delete ${username}`;
  const inputMatches = confirmInput.trim().toLowerCase() === expectedPhrase.toLowerCase();

  async function handleDelete() {
    if (!inputMatches || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      // Our own record first: a Cognito user with no account row can still
      // sign in and be repaired, where the reverse cannot.
      await deleteAccount();
      await deleteUser();
      onDeleted();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't delete account. Please try again."));
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open
      title="Delete account"
      onClose={onClose}
      dismissible={!deleting}
      alert
      footer={
        <>
          <Button onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="destructive"
            busy={deleting}
            disabled={!inputMatches}
          >
            Delete account
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={classes.form}
        onSubmit={(event) => {
          event.preventDefault();
          handleDelete();
        }}
      >
        <p className={classes.warning}>
          This deletes your account and everything in it — places, trips, media, maps and
          settings. It cannot be undone.
        </p>
        <TextField
          label={`Type "${expectedPhrase}" to confirm`}
          value={confirmInput}
          onChange={(event) => setConfirmInput(event.target.value)}
          placeholder={expectedPhrase}
          disabled={deleting}
          data-autofocus
        />
        {error && <ErrorBanner message={error} />}
      </form>
    </Dialog>
  );
}

export default DeleteAccountDialog;
