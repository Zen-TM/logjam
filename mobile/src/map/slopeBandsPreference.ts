// The account's slope bands (`uiPreferences.slopeBands`), which colour the
// Terrain group's slope. Chosen on Logjam Web; kept on the phone as last seen,
// so a map opened with no signal still draws the user's own bands.
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

/** Take the bands an account fetch brought, when they are bands at all. */
export function keepAccountSlopeBands(value: unknown): void {
  const bands = parseSlopeBands(value);
  if (!bands || JSON.stringify(bands) === JSON.stringify(readSlopeBands()))
    return;
  current = bands;
  writePref(SLOPE_BANDS_PREF_KEY, JSON.stringify(bands));
  for (const listener of listeners) listener();
}
