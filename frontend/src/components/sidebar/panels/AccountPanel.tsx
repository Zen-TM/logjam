import { useState, useEffect } from "react";
import {
  updateUsername,
  updateNotificationPreferences,
  updateUserPreferences,
  exportUserData,
  type TUser,
} from "../../../canyonUtils";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  CUSTOM_FIELD_TYPES,
  customFieldDisplayLabel,
  renameCustomFieldLabel,
  type NotificationPreferences,
  type TripLogCustomFieldDef,
} from "@logjam/shared";
import { useAuth } from "../../../useAuth";
import { useThemePreferences } from "../../../themePreferences";
import DeleteAccountDialog from "../../dialogs/DeleteAccountDialog";
import ChangeEmailDialog from "../../dialogs/ChangeEmailDialog";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import DeleteCustomFieldDialog from "../../dialogs/DeleteCustomFieldDialog";
import { useCustomFieldImpact } from "../../dialogs/useCustomFieldImpact";
import classes from "./AccountPanel.module.css";
import { useToast } from "../../feedback/ToastProvider";
import { messageFromError } from "../../../errors/messageFromError";
import { ErrorBanner } from "../../feedback/ErrorBanner";
import Footer from "../../Footer";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function customFieldTypeName(type: TripLogCustomFieldDef["type"]): string {
  return CUSTOM_FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
}

function AccountPanel({
  currentUser,
  customFieldDefs,
  onCustomFieldDefsChange,
}: {
  currentUser: TUser | null;
  // Custom trip-log field definitions (App-level state, shared with the trip
  // dialogs so a rename/delete here is immediately visible there).
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
}) {
  const { signOut } = useAuth();
  const toast = useToast();
  const { schemeId, schemes, isHydrating, isSaving, error: themeError, setThemeScheme } =
    useThemePreferences();
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaved, setUsernameSaved] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [changeEmailOpen, setChangeEmailOpen] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(null);
  const [notifSaving, setNotifSaving] = useState(false);
  const [autoDownloadGeoPdfs, setAutoDownloadGeoPdfs] = useState<boolean | null>(null);
  const [autoDownloadSaving, setAutoDownloadSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Custom trip-field management. Rename edits inline, then confirms with an
  // impact count; delete goes through the shared DeleteCustomFieldDialog.
  const [renamingFieldKey, setRenamingFieldKey] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [renameFieldError, setRenameFieldError] = useState<string | null>(null);
  // Set when the rename passes validation; holds the already-renamed defs
  // awaiting the user's confirm.
  const [pendingRename, setPendingRename] = useState<{
    key: string;
    oldLabel: string;
    newLabel: string;
    nextDefs: TripLogCustomFieldDef[];
  } | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [deletingFieldDef, setDeletingFieldDef] = useState<TripLogCustomFieldDef | null>(null);
  const { count: renameImpactCount, error: renameImpactError } = useCustomFieldImpact(
    pendingRename?.key ?? null,
  );

  function startRenameField(def: TripLogCustomFieldDef) {
    setRenamingFieldKey(def.key);
    setRenameInput(def.label);
    setRenameFieldError(null);
  }

  function cancelRenameField() {
    setRenamingFieldKey(null);
    setRenameInput("");
    setRenameFieldError(null);
  }

  function handleRenameFieldSubmit(def: TripLogCustomFieldDef) {
    const result = renameCustomFieldLabel(customFieldDefs, def.key, renameInput);
    if ("error" in result) {
      setRenameFieldError(result.error);
      return;
    }
    if (result.defs === customFieldDefs || renameInput.trim() === def.label) {
      // Unchanged — nothing to save.
      cancelRenameField();
      return;
    }
    setPendingRename({
      key: def.key,
      oldLabel: def.label,
      newLabel: renameInput.trim(),
      nextDefs: result.defs,
    });
  }

  async function handleConfirmRename() {
    if (!pendingRename) return;
    setRenameSaving(true);
    try {
      await updateUserPreferences({ tripLogCustomFields: pendingRename.nextDefs });
      onCustomFieldDefsChange(pendingRename.nextDefs);
      setPendingRename(null);
      cancelRenameField();
    } catch (err) {
      console.error(err);
      setPendingRename(null);
      setRenameFieldError(
        messageFromError(err, "Couldn't rename the custom field. Please try again."),
      );
    } finally {
      setRenameSaving(false);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    setCurrentUsername(currentUser.username);
    setUsernameInput(currentUser.username);
    setEmail(currentUser.email);
    setNotifPrefs({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(currentUser.uiPreferences?.notifications ?? {}),
    });
    setAutoDownloadGeoPdfs(currentUser.uiPreferences?.autoDownloadGeoPdfs ?? true);
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggleNotif(key: keyof NotificationPreferences) {
    if (!notifPrefs) return;
    const previous = notifPrefs;
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(next);
    setNotifSaving(true);
    try {
      await updateNotificationPreferences({ [key]: next[key] });
    } catch (err) {
      console.error(err);
      setNotifPrefs(previous);
      toast.error(messageFromError(err, "Couldn't save notification setting."));
    } finally {
      setNotifSaving(false);
    }
  }

  async function handleToggleAutoDownload() {
    if (autoDownloadGeoPdfs === null) return;
    const previous = autoDownloadGeoPdfs;
    const next = !autoDownloadGeoPdfs;
    setAutoDownloadGeoPdfs(next);
    setAutoDownloadSaving(true);
    try {
      await updateUserPreferences({ autoDownloadGeoPdfs: next });
    } catch (err) {
      console.error(err);
      setAutoDownloadGeoPdfs(previous);
      toast.error(messageFromError(err, "Couldn't save download setting."));
    } finally {
      setAutoDownloadSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await exportUserData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `logjam-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, "Couldn't download your data. Please try again."));
    } finally {
      setExporting(false);
    }
  }

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
      console.error(err);
      setUsernameError(messageFromError(err, "Couldn't save username. Please try again."));
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
            aria-label="Edit username"
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
          {usernameError && <ErrorBanner message={usernameError} />}
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

      <span className={classes.sectionLabel} title="Counts media files and topo job outputs (MBTiles/PMTiles and LiDAR ZIPs). Does not count cached map tiles.">Storage</span>
      <div className={classes.divider} />
      {!currentUser ? (
        <p className={classes.state}>Loading...</p>
      ) : (
        <>
          <progress
            className={classes.storageBar}
            value={currentUser.storageUsedBytes}
            max={currentUser.storageQuotaBytes}
          />
          <span className={classes.storageLabel}>
            {formatBytes(currentUser.storageUsedBytes)} of {formatBytes(currentUser.storageQuotaBytes)} used
          </span>
        </>
      )}

      <span className={classes.sectionLabel} title="Monthly quota for LiDAR map tiles served to the browser. Resets on the date shown.">LiDAR Processing</span>
      <div className={classes.divider} />
      {!currentUser ? (
        <p className={classes.state}>Loading...</p>
      ) : (
        <>
          <progress
            className={classes.storageBar}
            value={currentUser.monthlyTileUsage}
            max={currentUser.monthlyTileQuota}
          />
          <span className={classes.storageLabel}>
            {currentUser.monthlyTileUsage} / {currentUser.monthlyTileQuota} tiles this month
            {currentUser.monthlyTileResetAt ? ` · resets ${new Date(currentUser.monthlyTileResetAt).toLocaleDateString("en-AU", { month: "short", day: "numeric" })}` : ""}
          </span>
        </>
      )}

      <span className={classes.sectionLabel}>Theme</span>
      <div className={classes.divider} />

      {themeError && <ErrorBanner message={themeError} />}
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

      <span className={classes.sectionLabel}>Notifications</span>
      <div className={classes.divider} />
      {notifPrefs === null ? (
        <p className={classes.state}>Loading...</p>
      ) : (
        <div className={classes.notifGroup}>
          <label className={classes.notifRow}>
            <input
              type="checkbox"
              checked={notifPrefs.topoEmail}
              onChange={() => handleToggleNotif("topoEmail")}
              disabled={notifSaving}
            />
            <span className={classes.notifLabel}>Email me when a topo job finishes</span>
          </label>
          <label className={classes.notifRow}>
            <input
              type="checkbox"
              checked={notifPrefs.exportEmail}
              onChange={() => handleToggleNotif("exportEmail")}
              disabled={notifSaving}
            />
            <span className={classes.notifLabel}>Email me when a topo export is ready</span>
          </label>
          <label className={classes.notifRow}>
            <input
              type="checkbox"
              checked={notifPrefs.geoPdfEmail}
              onChange={() => handleToggleNotif("geoPdfEmail")}
              disabled={notifSaving}
            />
            <span className={classes.notifLabel}>Email me when a GeoPDF is ready</span>
          </label>
          <label className={classes.notifRow}>
            <input
              type="checkbox"
              checked={notifPrefs.friendRequestInApp}
              onChange={() => handleToggleNotif("friendRequestInApp")}
              disabled={notifSaving}
            />
            <span className={classes.notifLabel}>In-app notification for friend requests</span>
          </label>
          <label className={classes.notifRow}>
            <input
              type="checkbox"
              checked={notifPrefs.shareInApp}
              onChange={() => handleToggleNotif("shareInApp")}
              disabled={notifSaving}
            />
            <span className={classes.notifLabel}>In-app notification when a canyon is shared with me</span>
          </label>
        </div>
      )}

      <span className={classes.sectionLabel}>Downloads</span>
      <div className={classes.divider} />
      {autoDownloadGeoPdfs === null ? (
        <p className={classes.state}>Loading...</p>
      ) : (
        <div className={classes.notifGroup}>
          <label className={classes.notifRow}>
            <input
              type="checkbox"
              checked={autoDownloadGeoPdfs}
              onChange={handleToggleAutoDownload}
              disabled={autoDownloadSaving}
            />
            <span className={classes.notifLabel}>
              Auto-download a GeoPDF when it finishes generating (this browser only)
            </span>
          </label>
        </div>
      )}

      <span
        className={classes.sectionLabel}
        title="Extra fields you've added to trip logs (e.g. Water Level). Renaming keeps existing values; deleting removes the field and its values from all trips."
      >
        Custom trip fields
      </span>
      <div className={classes.divider} />
      {!currentUser ? (
        <p className={classes.state}>Loading...</p>
      ) : customFieldDefs.length === 0 ? (
        <p className={classes.state}>
          No custom trip fields yet. Add one from the trip log dialog.
        </p>
      ) : (
        customFieldDefs.map((def) =>
          renamingFieldKey === def.key ? (
            <div key={def.key} className={classes.fieldEdit}>
              <input
                className={classes.usernameInput}
                aria-label={`Rename field ${def.label}`}
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameFieldSubmit(def);
                  if (e.key === "Escape") cancelRenameField();
                }}
                autoFocus
                maxLength={64}
                disabled={renameSaving}
              />
              <div className={classes.usernameActions}>
                <button
                  className={classes.saveUsernameBtn}
                  onClick={() => handleRenameFieldSubmit(def)}
                  disabled={renameSaving}
                >
                  {renameSaving ? "Saving…" : "Save"}
                </button>
                <button
                  className={classes.cancelUsernameBtn}
                  onClick={cancelRenameField}
                  disabled={renameSaving}
                >
                  Cancel
                </button>
              </div>
              {renameFieldError && <ErrorBanner message={renameFieldError} />}
            </div>
          ) : (
            <div key={def.key} className={classes.fieldRow}>
              <div className={classes.fieldInfo}>
                <span className={classes.fieldName}>{customFieldDisplayLabel(def)}</span>
                <span className={classes.fieldType}>{customFieldTypeName(def.type)}</span>
              </div>
              <button
                className={classes.renameFieldBtn}
                onClick={() => startRenameField(def)}
              >
                Rename
              </button>
              <button
                className={classes.deleteFieldBtn}
                onClick={() => setDeletingFieldDef(def)}
              >
                Delete
              </button>
            </div>
          ),
        )
      )}

      <span className={classes.sectionLabel}>Your data</span>
      <div className={classes.divider} />
      <button
        className={classes.exportBtn}
        onClick={handleExport}
        disabled={exporting}
      >
        {exporting ? "Preparing..." : "Download my data"}
      </button>

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
        currentEmail={email ?? ""}
      />

      {/* Rename impact confirm — values stay linked (the field's key is stable),
          so this is informational, not destructive. */}
      <ConfirmDialog
        open={pendingRename !== null}
        title={`Rename "${pendingRename?.oldLabel ?? ""}"?`}
        message={
          <>
            The field will be renamed to "{pendingRename?.newLabel ?? ""}".{" "}
            {renameImpactError
              ? "Couldn't check how many trips use this field, but renaming is safe — "
              : renameImpactCount === null
                ? "Checking how many trips use it… "
                : renameImpactCount === 0
                  ? "No trip logs currently have a value for this field. "
                  : `${renameImpactCount} trip log${renameImpactCount === 1 ? " has" : "s have"} a value for this field — `}
            {(renameImpactError || (renameImpactCount !== null && renameImpactCount > 0)) &&
              "existing values are kept and will appear under the new name."}
          </>
        }
        confirmLabel="Rename"
        confirmColor="secondary"
        busy={renameSaving}
        onConfirm={handleConfirmRename}
        onClose={() => {
          if (!renameSaving) setPendingRename(null);
        }}
      />

      {/* Delete impact confirm + delete (shared with TripLogDialog). */}
      <DeleteCustomFieldDialog
        def={deletingFieldDef}
        onClose={() => setDeletingFieldDef(null)}
        onDeleted={(remaining) => onCustomFieldDefsChange(remaining)}
      />

      <Footer />
    </div>
  );
}

export default AccountPanel;
