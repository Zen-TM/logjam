import { useState, useEffect } from "react";
import { fetchCurrentUser, updateUsername } from "../../../canyonUtils";
import { useAuth } from "../../../useAuth";
import { useThemePreferences } from "../../../themePreferences";
import DeleteAccountDialog from "../../dialogs/DeleteAccountDialog";
import ChangeEmailDialog from "../../dialogs/ChangeEmailDialog";
import classes from "./AccountPanel.module.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function AccountPanel() {
  const { signOut } = useAuth();
  const { schemeId, schemes, isHydrating, isSaving, error: themeError, setThemeScheme } =
    useThemePreferences();
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaved, setUsernameSaved] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [storageUsedBytes, setStorageUsedBytes] = useState<number | null>(null);
  const [storageQuotaBytes, setStorageQuotaBytes] = useState<number | null>(null);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [changeEmailOpen, setChangeEmailOpen] = useState(false);

  useEffect(() => {
    fetchCurrentUser()
      .then((u) => {
        setCurrentUsername(u.username);
        setUsernameInput(u.username);
        setEmail(u.email);
        setStorageUsedBytes(u.storageUsedBytes);
        setStorageQuotaBytes(u.storageQuotaBytes);
      })
      .catch(console.error);
  }, []);

  async function handleSaveUsername() {
    const trimmed = usernameInput.trim();
    if (!trimmed) return;
    setUsernameSaving(true);
    setUsernameError(null);
    try {
      const updated = await updateUsername(trimmed);
      setCurrentUsername(updated.username);
      setUsernameInput(updated.username);
      setEditingUsername(false);
      setUsernameSaved(true);
      setTimeout(() => setUsernameSaved(false), 2500);
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setUsernameSaving(false);
    }
  }

  return (
    <div className={classes.root}>
      <span className={classes.sectionLabel}>Username</span>
      <div className={classes.divider} />
      {currentUsername === null ? (
        <p className={classes.state}>Loading...</p>
      ) : editingUsername ? (
        <div className={classes.usernameEdit}>
          <input
            className={classes.usernameInput}
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveUsername();
              if (e.key === "Escape") {
                setEditingUsername(false);
                setUsernameInput(currentUsername);
                setUsernameError(null);
              }
            }}
            autoFocus
            maxLength={32}
            disabled={usernameSaving}
          />
          <div className={classes.usernameActions}>
            <button
              className={classes.saveUsernameBtn}
              onClick={handleSaveUsername}
              disabled={usernameSaving}
            >
              {usernameSaving ? "Saving…" : "Save"}
            </button>
            <button
              className={classes.cancelUsernameBtn}
              onClick={() => {
                setEditingUsername(false);
                setUsernameInput(currentUsername);
                setUsernameError(null);
              }}
              disabled={usernameSaving}
            >
              Cancel
            </button>
          </div>
          {usernameError && <p className={classes.error}>{usernameError}</p>}
        </div>
      ) : (
        <div className={classes.usernameRow}>
          <span className={classes.usernameDisplay}>{currentUsername}</span>
          <button
            className={classes.editUsernameBtn}
            onClick={() => setEditingUsername(true)}
          >
            Edit
          </button>
          {usernameSaved && <span className={classes.savedHint}>Saved</span>}
        </div>
      )}

      <span className={classes.sectionLabel}>Email</span>
      <div className={classes.divider} />
      {email === null ? (
        <p className={classes.state}>Loading...</p>
      ) : (
        <div className={classes.emailRow}>
          <span className={classes.infoValue}>{email}</span>
          <button
            className={classes.changeEmailBtn}
            onClick={() => setChangeEmailOpen(true)}
          >
            Change
          </button>
        </div>
      )}

      <span className={classes.sectionLabel}>Storage</span>
      <div className={classes.divider} />
      {storageUsedBytes === null || storageQuotaBytes === null ? (
        <p className={classes.state}>Loading...</p>
      ) : (
        <>
          <progress
            className={classes.storageBar}
            value={storageUsedBytes}
            max={storageQuotaBytes}
          />
          <span className={classes.storageLabel}>
            {formatBytes(storageUsedBytes)} of {formatBytes(storageQuotaBytes)} used
          </span>
        </>
      )}

      <span className={classes.sectionLabel}>Theme</span>
      <div className={classes.divider} />

      {themeError && <p className={classes.error}>{themeError}</p>}
      {isHydrating && <p className={classes.state}>Loading your saved theme...</p>}
      {isSaving && <p className={classes.state}>Saving theme...</p>}

      {schemes.map((scheme) => {
        const isSelected = scheme.id === schemeId;
        const cardClass = `${classes.card} ${isSelected ? classes.cardSelected : ""}`;
        return (
          <button
            key={scheme.id}
            type="button"
            className={cardClass}
            onClick={() => setThemeScheme(scheme.id)}
            disabled={isSaving}
            aria-pressed={isSelected}
          >
            <div className={classes.cardHeader}>
              <h3 className={classes.cardName}>{scheme.name}</h3>
              <div className={classes.swatches}>
                {[scheme.tokens.primary, scheme.tokens.secondary, scheme.tokens.accent].map((color) => (
                  <span
                    key={color}
                    className={classes.swatch}
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>
          </button>
        );
      })}

      <button className={classes.signOutBtn} onClick={signOut}>
        Sign out
      </button>
      <button className={classes.deleteAccountBtn} onClick={() => setDeleteAccountOpen(true)}>
        Delete account
      </button>

      {currentUsername !== null && (
        <DeleteAccountDialog
          open={deleteAccountOpen}
          onClose={() => setDeleteAccountOpen(false)}
          username={currentUsername}
          onDeleted={signOut}
        />
      )}
      <ChangeEmailDialog
        open={changeEmailOpen}
        onClose={() => setChangeEmailOpen(false)}
        onSuccess={(newEmail) => setEmail(newEmail)}
      />
    </div>
  );
}

export default AccountPanel;
