// The leaderboard's podium card, once dismissed, stays dismissed on this phone
// for that season: a device preference, like the gallery switch, with no row
// on the server (shared/src/contracts/leaderboard.ts). The value is the season
// label, so next season's podium shows again without anything to clear.
import { readPref, writePref } from "../prefsDb";

const PODIUM_DISMISSED_KEY = "leaderboardPodiumDismissed";

export function isPodiumDismissed(season: string): boolean {
  return readPref(PODIUM_DISMISSED_KEY) === season;
}

/** False when the device refused to store it, so the caller can say so. */
export function dismissPodium(season: string): boolean {
  return writePref(PODIUM_DISMISSED_KEY, season);
}
