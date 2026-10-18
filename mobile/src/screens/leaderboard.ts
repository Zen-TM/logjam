// The leaderboard's own logic on Logjam GPS: where the user stands, what the
// nudge says, and the podium card's dismissal.
//
// The podium card, once dismissed, stays dismissed on this phone
// for that season: a device preference, like the gallery switch, with no row
// on the server (shared/src/contracts/leaderboard.ts). The value is the season
// label, so next season's podium shows again without anything to clear.
import type { LeaderboardResponse } from "@logjam/shared";

import { readPref, writePref } from "../prefsDb";

export type Board = Extract<LeaderboardResponse, { joined: true }>;

/** Where the user stands, for the hero and for the row on Friends. */
export function selfStanding(board: Board): { rank: number; size: number } {
  const self = board.entries.find((entry) => entry.isSelf);
  return { rank: self?.rank ?? 1, size: board.entries.length };
}

/** What the nudge says: who to ask, that it is only the user, or nothing on a
 *  board everyone has joined. */
export function nudgeKind(board: Board): "ask" | "alone" | null {
  if (board.notJoined.length > 0) return "ask";
  return board.entries.length < 2 ? "alone" : null;
}

const PODIUM_DISMISSED_KEY = "leaderboardPodiumDismissed";

export function isPodiumDismissed(season: string): boolean {
  return readPref(PODIUM_DISMISSED_KEY) === season;
}

/** False when the device refused to store it, so the caller can say so. */
export function dismissPodium(season: string): boolean {
  return writePref(PODIUM_DISMISSED_KEY, season);
}
