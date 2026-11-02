// The map search box's recent picks, in localStorage on this browser only.
// They are place names, so sign-out clears them like a trip draft
// (useAuth.ts endSession; useAuth.test.ts).
import { readRecentSearches, type RecentSearch } from "@logjam/shared";

export const RECENT_SEARCHES_KEY = "logjam.recentSearches";

export function loadRecentSearches(): RecentSearch[] {
  try {
    return readRecentSearches(
      JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "null"),
    );
  } catch {
    return [];
  }
}

export function saveRecentSearches(list: readonly RecentSearch[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(RECENT_SEARCHES_KEY);
    else localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: recents are a convenience.
  }
}

export const clearRecentSearches = () => saveRecentSearches([]);
