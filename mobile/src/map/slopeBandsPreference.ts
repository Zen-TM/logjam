// The account's slope bands (`uiPreferences.slopeBands`), which colour the
// Terrain group's slope. Chosen on either client; kept on the phone as last
// seen, so a map opened with no signal still draws the user's own bands.
import { useSyncExternalStore } from "react";
import {
  messageFromError,
  normalizeUserUiPreferences,
  parseSlopeBands,
  type SlopeBand,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { readPref, writePref } from "../prefsDb";

const SLOPE_BANDS_PREF_KEY = "mapSlopeBands";

let current: SlopeBand[] | null = null;
const listeners = new Set<() => void>();

function stored(): SlopeBand[] {
  try {
    const bands = parseSlopeBands(
      JSON.parse(readPref(SLOPE_BANDS_PREF_KEY) ?? "null"),
    );
    if (bands) return bands;
  } catch {
    // A damaged copy reads as never kept.
  }
  return normalizeUserUiPreferences(null).slopeBands;
}

/** The bands to draw now: the account's as last seen, or the defaults. */
export function readSlopeBands(): SlopeBand[] {
  return (current ??= stored());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSlopeBands(): SlopeBand[] {
  return useSyncExternalStore(subscribe, readSlopeBands);
}

function keep(bands: SlopeBand[]): void {
  if (JSON.stringify(bands) === JSON.stringify(readSlopeBands())) return;
  current = bands;
  writePref(SLOPE_BANDS_PREF_KEY, JSON.stringify(bands));
  for (const listener of listeners) listener();
}

// ── Sending the user's edits to the account ────────────────────────────────
//
// There is no outbox for account preferences (the theme and the other settings
// are plain `PATCH /users/me` writes), so this is the whole of it: the latest
// edit the account has not acknowledged (`dirty`), one send in flight at a
// time, and a pause so a number typed in steps is one request. It lives here,
// not in the editor, so closing the editor never drops or strands an edit.
// In memory on purpose: kept on disk, an edit could reach a different account
// that signs in on this phone.
const SEND_DELAY_MS = 800;

let account: { signedIn: boolean; id: string | null } = {
  signedIn: false,
  id: null,
};
let dirty: SlopeBand[] | null = null;
let dirtyFor: string | null = null;
let failed = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false;
const statusListeners = new Set<() => void>();

function setFailed(next: boolean): void {
  if (failed === next) return;
  failed = next;
  for (const listener of statusListeners) listener();
}

/** Whether the last edit could not reach the account (it is kept on the phone). */
export const slopeBandsSendFailed = (): boolean => failed;

export function useSlopeBandsSendFailed(): boolean {
  return useSyncExternalStore((listener) => {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
  }, slopeBandsSendFailed);
}

/**
 * Who the edits are sent to: told by the shell, which already holds the
 * account. Signed in with no id yet (no signal on a cold open) is an account
 * that cannot be reached, not a guest.
 */
export function setSlopeBandsAccount(next: {
  signedIn: boolean;
  id: string | null;
}): void {
  account = next;
  // An edit made for a different account is not this one's.
  if (dirty && dirtyFor != null && dirtyFor !== next.id) forgetSlopeBandsEdit();
  if (dirty && dirtyFor == null && next.id != null) {
    dirtyFor = next.id;
    schedule();
  }
}

/** Bands edited on this phone: drawn and kept now, sent to the account soon. */
export function editSlopeBands(bands: SlopeBand[]): void {
  keep(bands);
  if (!account.signedIn) return; // A guest has no account copy to send to.
  dirty = bands;
  dirtyFor = account.id;
  setFailed(account.id == null);
  schedule();
}

function schedule(): void {
  clearTimeout(timer);
  timer = undefined;
  if (dirty && account.id != null) timer = setTimeout(send, SEND_DELAY_MS);
}

/** Send a waiting edit now: the editor closing must not wait out the pause. */
export function flushSlopeBands(): void {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
  void send();
}

async function send(): Promise<void> {
  timer = undefined;
  if (sending || !dirty || account.id == null) return;
  const batch = dirty;
  sending = true;
  try {
    await apiFetch("/users/me", {
      method: "PATCH",
      body: { slopeBands: batch },
    });
    // Acknowledged only when nothing newer was kept meanwhile: the account's
    // older bands may still be on their way, and a newer edit is still unsent.
    if (dirty && JSON.stringify(dirty) === JSON.stringify(batch)) {
      dirty = null;
      dirtyFor = null;
    }
    setFailed(false);
  } catch (err) {
    console.error(messageFromError(err, "Couldn't save slope bands."));
    setFailed(true);
    return;
  } finally {
    sending = false;
  }
  if (dirty) void send();
}

/** Drop any waiting edit and who it was for: the sign-out wipe, and a changed account. */
export function forgetSlopeBandsEdit(): void {
  clearTimeout(timer);
  timer = undefined;
  dirty = null;
  dirtyFor = null;
  setFailed(false);
}

/** Take the bands an account fetch brought, when they are bands at all. */
export function keepAccountSlopeBands(value: unknown, userId?: string): void {
  // An edit this account has not acknowledged is newer than what it brings.
  if (dirty && (dirtyFor == null || dirtyFor === userId)) return;
  const bands = parseSlopeBands(value);
  if (bands) keep(bands);
}
