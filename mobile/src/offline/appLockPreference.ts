// The app lock's on/off switch (Settings → This phone), and the asymmetry that
// makes it safe.
//
// The lock is what stands between someone holding this unlocked phone and the
// canyon coordinates on it (mobile/CLAUDE.md privacy mandate). So:
//
// - Turning it OFF requires the device authenticator — otherwise the switch is a
//   one-tap bypass of the thing it controls, reachable by anyone holding the
//   phone while it happens to be unlocked. Turning it back ON is free; raising a
//   guard never needs permission.
// - It is DEVICE-scoped, in `prefsDb` rather than the account: it is a statement
//   about this handset's physical security, and pushing it to the account would
//   silently unlock the user's other phone too.
//
// **It defaults to OFF, and an unreadable pref reads as off.** This is a
// deliberate departure from the privacy mandate's fail-safe default, made by the
// operator: a lock that arms itself on a fresh install puts a biometric prompt
// between the user and every cold start and every return from the camera, and
// the friction was costing more than the guard was worth in the field. The
// asymmetry above still stands for anyone who turns it on — this changes which
// side the app starts on, not how hard it is to lower once raised.
//
// What it gates is no longer conditional on downloads: the mirror holds synced
// canyon names and coordinates from the moment the user signs in, so "there is
// nothing to protect yet" was never true (see AppLockGate).
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
 * Synchronous, so the gate's first render is already correct. Only an explicit
 * "on" means on — a missing store, a corrupted value and a fresh install all
 * read as OFF (see the header note on why this default is not fail-safe).
 */
export function isAppLockEnabled(): boolean {
  return readPref(APP_LOCK_PREF_KEY) === "on";
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
