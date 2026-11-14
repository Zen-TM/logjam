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
import type { Region } from "./regions.js";

/**
 * A season runs winter to winter, so a whole canyoning summer sits in one
 * season: 21 June to 20 June south of the equator, 21 December to 20 December
 * north of it. Trip dates are UTC-midnight date-only values, so the bounds are
 * too: `start` is the opening day's date, `end` the next one's, half-open.
 * Only "which season is today" reads a clock, in the region's time zone.
 */
const SEASON_START_DAY = 21;

/** What a season reads of a region: where its winter is, and its calendar day. */
export type SeasonRegion = Pick<Region, "timeZone" | "view">;

/**
 * The day a region's seasons open, month 1 to 12: the one rule the season
 * maths and the leaderboard's rules text both read. Each season ends the day
 * before the next opens.
 */
export function seasonOpening(region: SeasonRegion): {
  month: number;
  day: number;
} {
  return { month: region.view.center[1] < 0 ? 6 : 12, day: SEASON_START_DAY };
}

export type Season = {
  /** Inclusive, UTC midnight of the opening day. */
  start: Date;
  /** Exclusive, UTC midnight of the next opening day. */
  end: Date;
  /** "2026–27" */
  label: string;
};

function seasonStartingIn(year: number, region: SeasonRegion): Season {
  const endYear = (year + 1) % 100;
  const { month, day } = seasonOpening(region);
  return {
    start: new Date(Date.UTC(year, month - 1, day)),
    end: new Date(Date.UTC(year + 1, month - 1, day)),
    label: `${year}–${endYear.toString().padStart(2, "0")}`,
  };
}

/** Today's date in the region, as the UTC-midnight instant a trip dated today has. */
function regionToday(now: Date, region: SeasonRegion): Date {
  const local = DateTime.fromJSDate(now, { zone: region.timeZone });
  return new Date(Date.UTC(local.year, local.month - 1, local.day));
}

export function currentSeason(now: Date, region: SeasonRegion): Season {
  const today = regionToday(now, region);
  const year = today.getUTCFullYear();
  return today < seasonStartingIn(year, region).start
    ? seasonStartingIn(year - 1, region)
    : seasonStartingIn(year, region);
}

export function previousSeason(now: Date, region: SeasonRegion): Season {
  return seasonStartingIn(
    currentSeason(now, region).start.getUTCFullYear() - 1,
    region,
  );
}

/** Days after a season ends that a top-three finish is celebrated. */
export const PODIUM_CELEBRATION_DAYS = 7;

/** Whether today (in the region) is within the week after the previous season ended. */
export function isPodiumWeek(now: Date, region: SeasonRegion): boolean {
  const today = regionToday(now, region).getTime();
  const end = previousSeason(now, region).end.getTime();
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
