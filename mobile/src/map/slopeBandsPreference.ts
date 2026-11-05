// The account's slope bands (`uiPreferences.slopeBands`), which colour the
// Terrain group's slope. Chosen on either client; kept on the phone as last
// seen, so a map opened with no signal still draws the user's own bands.
import { useSyncExternalStore } from "react";
import {
  normalizeUserUiPreferences,
  parseSlopeBands,
  type SlopeBand,
} from "@logjam/shared";

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

/** Bands edited on this phone: drawn and kept now, whatever the signal. */
export function keepEditedSlopeBands(bands: SlopeBand[]): void {
  keep(bands);
}

// The account an edit has not reached yet. Until it has, that account's fetch
// brings the older bands and must not undo the edit. In memory on purpose:
// kept on disk it could reach a different account that signs in on this phone.
let unsentFor: string | null = null;

/** An edit on this phone is waiting to reach `userId`'s account, or (null) none is. */
export function holdAccountSlopeBands(userId: string | null): void {
  unsentFor = userId;
}

/** Take the bands an account fetch brought, when they are bands at all. */
export function keepAccountSlopeBands(value: unknown, userId?: string): void {
  if (userId != null && userId === unsentFor) return;
  const bands = parseSlopeBands(value);
  if (bands) keep(bands);
}
