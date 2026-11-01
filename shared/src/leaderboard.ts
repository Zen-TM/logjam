// The friends leaderboard: the season window, the score and the ranking — one
// source, so the API that computes a board and the clients that explain it
// cannot disagree about when a season ends or who is first.
//
// PRIVACY. A score is a count of owner-private trip data, which ADR 0002 keeps
// owner-private; its 2026-10-18 update makes this the one opt-in exception:
// `uiPreferences.leaderboardOptIn`, default false. Until a user joins
// they neither appear on a board nor see one, and once joined a friend sees
// their username and one integer, never which places. The participant filter
// is `collectLeaderboardParticipants` in api/src/routes/friends.ts, guarded by
// api/src/routes/leaderboard.unit.test.ts and api/src/__tests__/leaderboard.test.ts.

import { DateTime } from "luxon";
import { SYDNEY_TZ } from "./monthlyQuota.js";

/**
 * A season runs winter to winter: 21 June to 20 June, so a whole canyoning
 * summer sits in one season. Trip dates are UTC-midnight date-only values, so
 * the bounds are too: `start` is 21 June's date, `end` the next 21 June's,
 * half-open. Only "which season is today" reads a clock, in Sydney time.
 */
const SEASON_START_MONTH = 6;
const SEASON_START_DAY = 21;

export type Season = {
  /** Inclusive, UTC midnight of 21 June. */
  start: Date;
  /** Exclusive, UTC midnight of the next 21 June. */
  end: Date;
  /** "2026–27" */
  label: string;
};

function seasonStartingIn(year: number): Season {
  const endYear = (year + 1) % 100;
  return {
    start: new Date(Date.UTC(year, SEASON_START_MONTH - 1, SEASON_START_DAY)),
    end: new Date(Date.UTC(year + 1, SEASON_START_MONTH - 1, SEASON_START_DAY)),
    label: `${year}–${endYear.toString().padStart(2, "0")}`,
  };
}

/** Today's date in Sydney, as the UTC-midnight instant a trip dated today has. */
function sydneyToday(now: Date): Date {
  const local = DateTime.fromJSDate(now, { zone: SYDNEY_TZ });
  return new Date(Date.UTC(local.year, local.month - 1, local.day));
}

export function currentSeason(now = new Date()): Season {
  const today = sydneyToday(now);
  const year = today.getUTCFullYear();
  return today < seasonStartingIn(year).start
    ? seasonStartingIn(year - 1)
    : seasonStartingIn(year);
}

export function previousSeason(now = new Date()): Season {
  return seasonStartingIn(currentSeason(now).start.getUTCFullYear() - 1);
}

/** Days after a season ends that a top-three finish is celebrated. */
export const PODIUM_CELEBRATION_DAYS = 7;

/** Whether today (Sydney) is within the week after the previous season ended. */
export function isPodiumWeek(now = new Date()): boolean {
  const today = sydneyToday(now).getTime();
  const end = previousSeason(now).end.getTime();
  return today >= end && today < end + PODIUM_CELEBRATION_DAYS * 86_400_000;
}

export type LeaderboardInputRow = {
  userId: string;
  username: string;
  /** Every scoring place id linked by the user's trips in the season;
   *  repeats allowed. */
  placeIds: string[];
};

export type LeaderboardEntry = {
  userId: string;
  username: string;
  /** Distinct canyons: the same canyon twice counts once. */
  canyonCount: number;
  /** Standard competition rank: ties share it and use up the ranks below
   *  (1, 1, 3 — two golds, no silver). */
  rank: number;
};

/** Ranked by distinct canyons, most first; a tie lists by username. */
export function computeLeaderboard(
  rows: LeaderboardInputRow[],
): LeaderboardEntry[] {
  const counted = rows
    .map((row) => ({
      userId: row.userId,
      username: row.username,
      canyonCount: new Set(row.placeIds).size,
    }))
    .sort(
      (a, b) =>
        b.canyonCount - a.canyonCount || a.username.localeCompare(b.username),
    );
  return counted.map((entry) => ({
    ...entry,
    rank:
      counted.findIndex((other) => other.canyonCount === entry.canyonCount) + 1,
  }));
}

export type Medal = "gold" | "silver" | "bronze";

/**
 * A medal needs someone to beat and something done: a board of one has none,
 * and nor does a count of 0, or every board is all gold on 21 June.
 */
export function medalFor(
  standing: { rank: number; canyonCount: number },
  boardSize: number,
): Medal | null {
  if (boardSize < 2 || standing.canyonCount === 0) return null;
  return standing.rank === 1
    ? "gold"
    : standing.rank === 2
      ? "silver"
      : standing.rank === 3
        ? "bronze"
        : null;
}

// ── Wire shape of GET /friends/leaderboard ─────────────────────────────

export type LeaderboardRow = LeaderboardEntry & { isSelf: boolean };

export type LeaderboardResponse =
  | { joined: false }
  | {
      joined: true;
      season: string;
      entries: LeaderboardRow[];
      /** Usernames of accepted friends who have not joined, for the nudge. */
      notJoined: string[];
      /** Set only in the podium week, when the user finished top three last
       *  season. */
      podium: { season: string; rank: number; canyonCount: number } | null;
    };

export type LeaderboardBoard = Extract<LeaderboardResponse, { joined: true }>;

/** Where the user stands: the hero, and the row on Friends. */
export function selfStanding(board: LeaderboardBoard): {
  rank: number;
  size: number;
} {
  const self = board.entries.find((entry) => entry.isSelf);
  return { rank: self?.rank ?? 1, size: board.entries.length };
}

/** What the nudge says: who to ask, that it is only the user, or nothing on
 *  a board every friend has joined. */
export function nudgeKind(board: LeaderboardBoard): "ask" | "alone" | null {
  if (board.notJoined.length > 0) return "ask";
  return board.entries.length < 2 ? "alone" : null;
}
