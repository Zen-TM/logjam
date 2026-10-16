// "Auto-download finished GeoPDFs" — DEVICE-scoped.
//
// Stored per-device rather than on the user record
// (`uiPreferences.autoDownloadGeoPdfs`): whether this phone should spend
// tens of megabytes and minutes rasterising a file it may not need is a handset
// choice, not an account-wide setting. Device-scoped storage also reads
// synchronously, works for a guest, and can be changed with no signal.
//
// The account copy is not deleted: the web still writes and reads it, and it is
// what seeds this device the first time (see `seedAutoDownloadFromAccount`), so
// someone who turned the feature off in a browser does not find their phone
// downloading again.
//
// PRIVACY: one boolean about this device's willingness to fetch its own files.
import { readPref, writePref } from "../prefsDb";

const AUTO_DOWNLOAD_KEY = "autoDownloadGeoPdfs";

/** Defaults ON, matching the account default it replaces. */
export function isAutoDownloadEnabled(): boolean {
  return readPref(AUTO_DOWNLOAD_KEY) !== "off";
}

/** False when the device refused to store it, so the caller can say so. */
export function setAutoDownloadEnabled(enabled: boolean): boolean {
  return writePref(AUTO_DOWNLOAD_KEY, enabled ? "on" : "off");
}

/**
 * One-shot migration: adopt the account's value when this device has never
 * recorded one of its own. Only OFF is worth carrying — ON is already the
 * default, and writing it would consume the "never recorded" state that makes
 * this a one-shot.
 *
 * Called from the auto-download run itself, which has the user record in hand
 * anyway; it must not cost a fetch of its own.
 */
export function seedAutoDownloadFromAccount(
  accountValue: boolean | undefined,
): void {
  if (accountValue !== false) return;
  if (readPref(AUTO_DOWNLOAD_KEY) !== null) return;
  setAutoDownloadEnabled(false);
}
