// Whether this install is running as a guest — no Logjam account, everything
// on-device.
//
// Device-scoped and in `prefsDb` rather than the account, for the obvious
// reason: a guest has no account to put it in. It is read SYNCHRONOUSLY so the
// very first render of the auth gate is already correct — a guest must not see
// the sign-in screen flash before the chooser resolves (same rationale as
// `offline/appLockPreference.ts`).
//
// Three situations, two stored values:
//  - pref "on"      → guest. Local data only, gated features disabled.
//  - pref "off"     → the user chose an account. Normal auth flow.
//  - pref absent    → nothing chosen yet. Show the entry chooser.
//
// The absent case is why this returns a tri-state rather than a boolean:
// collapsing "not asked" into "not a guest" would put a fresh install straight
// on the sign-in form, which is exactly the barrier guest mode removes.
//
// PRIVACY: one enum string. No account identifiers, no canyon data.
import { readPref, writePref } from "../prefsDb";

const GUEST_MODE_PREF_KEY = "guestMode";

export type EntryChoice = "guest" | "account" | "unchosen";

/** Synchronous, so the gate's first render is already correct. */
export function readEntryChoice(): EntryChoice {
  const stored = readPref(GUEST_MODE_PREF_KEY);
  if (stored === "on") return "guest";
  if (stored === "off") return "account";
  return "unchosen";
}

/**
 * Record the entry choice. Returns false when it could not be stored — the
 * caller must surface that rather than proceed, because a guest choice that
 * didn't stick means the next cold start throws them back to the chooser with
 * their data apparently gone (it isn't, but it looks that way).
 */
export function writeEntryChoice(choice: Exclude<EntryChoice, "unchosen">): boolean {
  return writePref(GUEST_MODE_PREF_KEY, choice === "guest" ? "on" : "off");
}

/**
 * Back to "nothing chosen" — used by sign-out, which leaves the device with no
 * account on it at all.
 *
 * Writing an empty string rather than deleting the row because `prefsDb` has no
 * delete, and `readEntryChoice` already treats any unrecognised value as
 * unchosen. Without this, signing out landed on the chooser but a cold start
 * afterwards showed the sign-in form — two different screens for one state, and
 * the "carry on without an account" option silently disappearing overnight.
 */
export function clearEntryChoice(): boolean {
  return writePref(GUEST_MODE_PREF_KEY, "");
}
