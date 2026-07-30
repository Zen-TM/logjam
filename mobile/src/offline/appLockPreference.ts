// The app lock's on/off switch (Settings → This phone), and the asymmetry that
// makes it safe.
//
// The lock is what stands between someone holding this unlocked phone and the
// canyon coordinates stored on it (mobile/CLAUDE.md privacy mandate). So:
//
// - It defaults to ON, and stays on for a device that has never been asked.
// - Turning it OFF requires the device authenticator — otherwise the switch is a
//   one-tap bypass of the thing it controls, reachable by anyone holding the
//   phone while it happens to be unlocked. Turning it back ON is free; raising a
//   guard never needs permission.
// - It is DEVICE-scoped, in `prefsDb` rather than the account: it is a statement
//   about this handset's physical security, and pushing it to the account would
//   silently unlock the user's other phone too.
//
// It only has any effect once there IS offline data — with an empty device the
// gate passes through regardless, so the switch reads as "when there's something
// to protect".
import * as LocalAuthentication from "expo-local-authentication";

import { readPref, writePref } from "../prefsDb";

const APP_LOCK_PREF_KEY = "appLockEnabled";

type Listener = () => void;
const listeners = new Set<Listener>();

export function onAppLockPreferenceChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Synchronous, so the gate's first render is already correct. Anything other than
 * an explicit "off" means on — a missing store, a corrupted value and a fresh
 * install all fail SAFE.
 */
export function isAppLockEnabled(): boolean {
  return readPref(APP_LOCK_PREF_KEY) !== "off";
}

export type AppLockChange =
  | { status: "changed"; enabled: boolean }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

/**
 * Turn the lock on (free) or off (authenticate first).
 *
 * A device with nothing enrolled can't be asked, and has nothing to gate with
 * either — there the switch is allowed through, exactly as the gate itself passes
 * through in that case.
 */
export async function setAppLockEnabled(enabled: boolean): Promise<AppLockChange> {
  if (!enabled) {
    const authorised = await confirmWithDeviceAuth();
    if (authorised.status !== "ok") return authorised.result;
  }
  if (!writePref(APP_LOCK_PREF_KEY, enabled ? "on" : "off")) {
    return { status: "failed", message: "This phone wouldn't store that setting." };
  }
  for (const listener of listeners) listener();
  return { status: "changed", enabled };
}

type AuthOutcome = { status: "ok" } | { status: "no"; result: AppLockChange };

async function confirmWithDeviceAuth(): Promise<AuthOutcome> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return { status: "ok" };
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Turn off the app lock",
    });
    if (result.success) return { status: "ok" };
    if (result.error === "not_enrolled" || result.error === "not_available") {
      // The probe said "something", the authenticator says there is nothing
      // usable (emulators). Same conclusion as SecurityLevel.NONE.
      return { status: "ok" };
    }
    return { status: "no", result: { status: "cancelled" } };
  } catch (err) {
    // Fail CLOSED: an authenticator we couldn't reach does not authorise
    // lowering the guard.
    console.error(err);
    return {
      status: "no",
      result: { status: "failed", message: "Couldn't confirm it's you. The lock stays on." },
    };
  }
}
