// The search bar's recent picks, on this phone only (the device prefs store).
// They are place names, so unlike the other device preferences the wipe on
// sign-out clears them (offline/wipeLocalData.ts; wipeLocalData.test.ts).
import { readRecentSearches, type RecentSearch } from "@logjam/shared";

import { readPref, writePref } from "../prefsDb";

const KEY = "mapRecentSearches";

export function loadRecentSearches(): RecentSearch[] {
  try {
    return readRecentSearches(JSON.parse(readPref(KEY) ?? "null"));
  } catch {
    return [];
  }
}

export function saveRecentSearches(list: readonly RecentSearch[]): void {
  writePref(KEY, JSON.stringify(list));
}

export const clearRecentSearches = () => saveRecentSearches([]);
