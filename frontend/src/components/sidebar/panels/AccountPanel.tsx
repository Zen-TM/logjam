import { useEffect, useId, useState } from "react";
import { Download, LogOut, Mail, Pencil, Trash2 } from "lucide-react";
import { formatCredits } from "@logjam/shared";

import { updateUsername, exportUserData, type TUser } from "../../../placeUtils";
import { useAuth } from "../../../useAuth";
import DeleteAccountDialog from "../../dialogs/DeleteAccountDialog";
import ChangeEmailDialog from "../../dialogs/ChangeEmailDialog";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import { ErrorBanner } from "../../feedback/ErrorBanner";
import {
  Button,
  Dialog,
  Hero,
  IconButton,
  IconTile,
  ProgressBar,
  Row,
  SectionHeader,
  TextField,
} from "../../../ui";
import Footer from "../../Footer";
import classes from "./AccountPanel.module.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Percent used, clamped: a quota can be exceeded, and a bar past its end reads
 *  as a broken bar rather than as an over-quota account. */
function percentUsed(used: number, quota: number): number {
  if (quota <= 0) return 0;
  return Math.min(100, (used / quota) * 100);
}

/**
 * Account — "who am I here, and what am I using of it?" (DESIGN.md §1).
 *
 * The two quota meters ARE the question, so they lead. Everything else is the
 * sign-in identity and the two irreversible things: signing out and deleting
 * the account. The same shape as Logjam GPS's Account screen, which is where
 * the section order comes from.
 *
 * PRIVACY: username, email and byte counts. The email appears here and nowhere
 * else — friend search and lists are username-only (root CLAUDE.md).
 */
function AccountPanel({
  currentUser,
  error,
  onRetry,
}: {
  currentUser: TUser | null;
  /** The user record's own fetch failed. The page cannot answer its question
   *  without that row, so this replaces the loading state rather than sitting
   *  beside it — otherwise "Loading…" is what a user sees for good. */
  error: string | null;
  onRetry: () => void;
}) {
  const { signOut } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [changeEmailOpen, setChangeEmailOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    setUsername(currentUser.username);
    setEmail(currentUser.email);
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await exportUserData();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `logjam-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't download your data. Please try again."));
    } finally {
      setExporting(false);
    }
  }

  const creditsResetLabel = currentUser?.monthlyComputeResetAt
    ? new Date(currentUser.monthlyComputeResetAt).toLocaleDateString("en-AU", {
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div className={classes.root}>
      {/* The title is who you are — the page's own answer (DESIGN.md §1) —
          and it waits for the record rather than announcing a name the account
          may not have. */}
      <Hero
        title={username ?? "Account"}
        actions={
          username !== null && (
            <IconButton icon={Pencil} label="Change username" onClick={() => setRenameOpen(true)} />
          )
        }
      />

      <div className={classes.body}>
        {!currentUser ? (
          error ? (
            <ErrorBanner message={error} onRetry={onRetry} />
          ) : (
            <p className={classes.state}>Loading…</p>
          )
        ) : (
          <>
            <SectionHeader title="Storage" />
            <ProgressBar
              label="Storage used"
              value={percentUsed(currentUser.storageUsedBytes, currentUser.storageQuotaBytes)}
            />
            <p className={classes.meterLabel}>
              {formatBytes(currentUser.storageUsedBytes)} of{" "}
              {formatBytes(currentUser.storageQuotaBytes)}
              <span className={classes.meterHint}> · photos, videos and topos</span>
            </p>

            <SectionHeader title="Processing credits this month" />
            <ProgressBar
              label="Processing credits used"
              value={percentUsed(
                currentUser.monthlyComputeUsage,
                currentUser.monthlyComputeCredits,
              )}
            />
            <p className={classes.meterLabel}>
              {formatCredits(currentUser.monthlyComputeUsage)} of{" "}
              {formatCredits(currentUser.monthlyComputeCredits)}
              {creditsResetLabel && (
                <span className={classes.meterHint}> · resets {creditsResetLabel}</span>
              )}
              <span className={classes.meterHint}> · topos, exports and GeoPDFs</span>
            </p>

            <SectionHeader title="Sign-in" />
            {/* The pencil, not the card: a whole row that opens something is
                how this page moves BETWEEN places, and this one edits a value
                in place. The same verb, the same glyph and the same position
                as the username's, two rows above it. */}
            <Row
              leading={<IconTile icon={Mail} hue="var(--theme-accent)" />}
              title="Email"
              subtitle={email ?? undefined}
              trailing={
                <IconButton
                  icon={Pencil}
                  label="Change email address"
                  onClick={() => setChangeEmailOpen(true)}
                />
              }
            />

            <SectionHeader title="Your data" />
            <Button
              variant="outline"
              icon={Download}
              busy={exporting}
              onClick={handleExport}
            >
              Download my data
            </Button>

            <SectionHeader title="Leaving" />
            <Button variant="outline" icon={LogOut} onClick={signOut}>
              Sign out
            </Button>
            <Row
              leading={<IconTile icon={Trash2} hue="var(--theme-warning)" />}
              title="Delete account"
              onOpen={() => setDeleteAccountOpen(true)}
            />
          </>
        )}

        <Footer />
      </div>

      {username !== null && (
        <>
          <UsernameDialog
            open={renameOpen}
            current={username}
            onClose={() => setRenameOpen(false)}
            onSaved={(next) => {
              setUsername(next);
              setRenameOpen(false);
            }}
          />
          <DeleteAccountDialog
            open={deleteAccountOpen}
            onClose={() => setDeleteAccountOpen(false)}
            username={username}
            onDeleted={signOut}
          />
        </>
      )}
      <ChangeEmailDialog
        open={changeEmailOpen}
        onClose={() => setChangeEmailOpen(false)}
        onSuccess={(newEmail) => setEmail(newEmail)}
        currentEmail={email ?? ""}
      />
    </div>
  );
}

/** Renaming yourself. A dialog rather than an inline field: the one line under
 *  it — that this is the name friends search — is what makes the choice, and it
 *  has nowhere to live on a hero. */
function UsernameDialog({
  open,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  current: string;
  onClose: () => void;
  onSaved: (username: string) => void;
}) {
  return open ? (
    <UsernameForm current={current} onClose={onClose} onSaved={onSaved} />
  ) : null;
}

function UsernameForm({
  current,
  onClose,
  onSaved,
}: {
  current: string;
  onClose: () => void;
  onSaved: (username: string) => void;
}) {
  const formId = useId();
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = value.trim();
    // Empty is a requirement, reported on submit (DESIGN.md §8); unchanged is
    // not an error at all, just nothing to do.
    if (!trimmed) {
      setError("Enter a username.");
      return;
    }
    if (trimmed === current) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateUsername(trimmed);
      onSaved(updated.username);
    } catch (err) {
      console.error(err);
      // The server's own 409 text ("Username already taken") is worth showing,
      // which is what messageFromError prefers when the API supplies one.
      setError(messageFromError(err, "Couldn't save that username."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Change username"
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="filled" busy={saving}>
            Save
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={classes.form}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <TextField
          label="Username"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          hint="Friends search this name when they share a place with you."
          maxLength={32}
          disabled={saving}
          data-autofocus
        />
        {error && <ErrorBanner message={error} />}
      </form>
    </Dialog>
  );
}

export default AccountPanel;
