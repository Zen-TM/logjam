// The friends leaderboard: Logjam Web's `LeaderboardPage.tsx` inside the
// Friends panel and Logjam GPS's `screens/LeaderboardScreen.tsx`, pushed from
// Friends. Reached only by someone who has joined, from the button in Friends'
// hero that wears their rank; for anyone else nothing on Friends mentions it,
// and the one way in is the switch in Settings (`LEADERBOARD_SETTING`). Every number is
// `computeLeaderboard` on the server (shared/src/leaderboard.ts).
import { formatDayLongMonth } from "../dateFormat.js";
import { plural, t } from "../i18n.js";
import { seasonOpening, type SeasonRegion } from "../leaderboard.js";
import type { ScreenContract } from "./types.js";

export const LEADERBOARD = {
  id: "friends.leaderboard",
  question: t`How am I going against my friends this season?`,
  title: t`Leaderboard`,
  sections: [
    // The user's rank and the season.
    { key: "hero" },
    // The week after a season ends, for a top-three finish.
    { key: "podium" },
    { key: "board" },
    // Friends who have not joined, by name. No "ask them": a message to a
    // friend is easy to write, and Logjam has no business writing it.
    { key: "nudge" },
    // The rules are not a section: they sit behind the hero's `rulesTitle`
    // button, so a long board does not bury them.
  ],
  copy: {
    loading: t`Loading the leaderboard…`,
    loadFailed: t`Couldn't load the leaderboard.`,
    offline: t`The leaderboard needs a connection.`,
    you: t`you`,
    podiumDismiss: t`Dismiss`,
    // A board of one with no friend left to ask; with someone to ask, the
    // nudge names them instead.
    alone: t`It's just you until a friend joins.`,
    rulesTitle: t`How it works`,
    // The rules, a line each, either side of the season's dates, which
    // depend on the account's region (`leaderboardRules`).
    rulesBeforeSeason: [
      t`You're ranked by how many different canyons your trips this season went to. Doing one canyon twice counts once.`,
      t`Only places of the built-in Canyon type count, linked to a trip dated in the season.`,
    ].join("\n"),
    rulesAfterSeason: [
      t`Friends who've joined see your username and your count, never which canyons.`,
      t`Ties share a rank: two people level on most are both first.`,
      t`Finish in the top three and you'll see it here for a week after the season ends.`,
      t`Turn it off in Settings any time. You'll leave your friends' boards too.`,
    ].join("\n"),
  },
} as const satisfies ScreenContract;

/** The switch in Settings: the only way in, and the way out. */
export const LEADERBOARD_SETTING = {
  // Label and hint each fit one line on a phone, under the Friends heading
  // that says whose board it is. The hint is what joining shows. Each client's
  // `switchCopy.test.ts` ("keeps to the limit") holds both to `SWITCH_COPY_MAX`.
  label: t`Canyon leaderboard`,
  hint: t`Friends see only your count.`,
  joined: t`You're on the leaderboard. Find it in Friends.`,
  // Friends' standing line for someone who has friends and has not joined:
  // the one place besides Settings that says the board exists.
  offer: t`Rank your canyons against your friends: turn on the Canyon leaderboard in Settings.`,
  left: t`You've left the leaderboard.`,
  saveFailed: t`Couldn't change the leaderboard setting.`,
} as const;

/** The rank Friends' leaderboard button wears as a badge: none on a board of
 *  one, where a rank says nothing. "#2", not "2", which reads as a count. */
export function leaderboardBadge(
  rank: number,
  boardSize: number,
): string | null {
  return boardSize < 2 ? null : `#${rank}`;
}

/** That button's name, so the badge's number is in it (DESIGN.md: a badge is
 *  hidden, its count in the name). */
export function leaderboardButtonLabel(
  standing: { rank: number; size: number } | null,
): string {
  return standing && standing.size >= 2
    ? t`${LEADERBOARD.title}, you're #${standing.rank} of ${standing.size}`
    : LEADERBOARD.title;
}

/** The page's hero: the rank, then the season it is in. */
export function leaderboardHeroTitle(rank: number, boardSize: number): string {
  return boardSize < 2 ? t`Just you so far` : t`#${rank} of ${boardSize}`;
}

/** The hero's second line, on both clients. */
export function leaderboardSeasonLine(season: string): string {
  return t`${season} season`;
}

export function leaderboardCount(count: number): string {
  return plural(count, "# canyon", "# canyons");
}

export function leaderboardPodiumLine(podium: {
  season: string;
  rank: number;
  canyonCount: number;
}): string {
  const { rank, season } = podium;
  const canyons = leaderboardCount(podium.canyonCount);
  if (rank === 1) return t`You came first in ${season}, with ${canyons}.`;
  if (rank === 2) return t`You came second in ${season}, with ${canyons}.`;
  if (rank === 3) return t`You came third in ${season}, with ${canyons}.`;
  return t`You came #${rank} in ${season}, with ${canyons}.`;
}

/** The nudge, naming who hasn't joined. Empty when everyone has. */
export function leaderboardNudge(notJoined: readonly string[]): string {
  if (notJoined.length === 0) return "";
  if (notJoined.length === 1) return t`${notJoined[0]} isn't on it yet.`;
  const names = t`${notJoined.slice(0, -1).join(", ")} and ${notJoined[notJoined.length - 1]}`;
  return t`${names} aren't on it yet.`;
}

/** "How it works", a line each: the season's dates are the region's own (`seasonOpening`). */
export function leaderboardRules(region: SeasonRegion): string {
  const { month, day } = seasonOpening(region);
  const from = formatDayLongMonth({ day, month: month - 1 });
  const to = formatDayLongMonth({ day: day - 1, month: month - 1 });
  const season = t`A season runs from ${from} to ${to}.`;
  return [
    LEADERBOARD.copy.rulesBeforeSeason,
    season,
    LEADERBOARD.copy.rulesAfterSeason,
  ].join("\n");
}
