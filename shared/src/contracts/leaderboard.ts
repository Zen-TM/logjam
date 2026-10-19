// The friends leaderboard: Logjam Web's `LeaderboardPage.tsx` inside the
// Friends panel and Logjam GPS's `screens/LeaderboardScreen.tsx`, pushed from
// Friends. Reached only by someone who has joined, from the row Friends draws
// for them; for anyone else nothing on Friends mentions it, and the one way
// in is the switch in Settings (`LEADERBOARD_SETTING`). Every number is
// `computeLeaderboard` on the server (shared/src/leaderboard.ts).
import { pluralCount } from "../logbook.js";
import type { ScreenContract } from "./types.js";

export const LEADERBOARD = {
  id: "friends.leaderboard",
  question: "How am I going against my friends this season?",
  title: "Leaderboard",
  sections: [
    // The user's rank and the season.
    { key: "hero" },
    // The week after a season ends, for a top-three finish.
    { key: "podium" },
    { key: "board" },
    // Friends who have not joined, by name, with a way to ask them.
    { key: "nudge" },
    { key: "rules" },
  ],
  copy: {
    loading: "Loading the leaderboard…",
    loadFailed: "Couldn't load the leaderboard.",
    offline: "The leaderboard needs a connection.",
    you: "you",
    podiumDismiss: "Dismiss",
    // A board of one with no friend left to ask; with someone to ask, the
    // nudge names them instead.
    alone: "It's just you until a friend joins.",
    askFriends: "Ask them",
    askCopied: "Message copied. Send it to them.",
    // Logjam Web only: the browser refused the clipboard.
    askCopyFailed: "Couldn't copy the message.",
    rulesTitle: "How it works",
    rules: [
      "You're ranked by how many different canyons your trips this season went to. Doing one canyon twice counts once.",
      "Only places of the built-in Canyon type count, linked to a trip dated in the season.",
      "A season runs from 21 June to 20 June.",
      "Friends who've joined see your username and your count, never which canyons.",
      "Ties share a rank: two people level on most are both first.",
      "Finish in the top three and you'll see it here for a week after the season ends.",
      "Turn it off in Settings any time. You'll leave your friends' boards too.",
    ].join("\n"),
  },
} as const satisfies ScreenContract;

/** The switch in Settings: the only way in, and the way out. */
export const LEADERBOARD_SETTING = {
  label: "Friends leaderboard",
  hint: "Rank yourself against friends who've joined, by canyons done this season. They see your count, never which canyons.",
  joined: "You're on the leaderboard. Find it in Friends.",
  left: "You've left the leaderboard.",
  saveFailed: "Couldn't change the leaderboard setting.",
} as const;

/** Friends' row for someone who has joined: where they stand, not what it is. */
export function leaderboardRowSubtitle(
  rank: number,
  boardSize: number,
): string {
  return boardSize < 2 ? "Just you so far" : `You're #${rank} of ${boardSize}`;
}

/** The page's hero: the rank, then the season it is in. */
export function leaderboardHeroTitle(rank: number, boardSize: number): string {
  return boardSize < 2 ? "Just you so far" : `#${rank} of ${boardSize}`;
}

/** The hero's second line, on both clients. */
export function leaderboardSeasonLine(season: string): string {
  return `${season} season`;
}

export function leaderboardCount(count: number): string {
  return pluralCount(count, "canyon");
}

export function leaderboardPodiumLine(podium: {
  season: string;
  rank: number;
  canyonCount: number;
}): string {
  const place =
    ["", "first", "second", "third"][podium.rank] ?? `#${podium.rank}`;
  return `You came ${place} in ${podium.season}, with ${leaderboardCount(podium.canyonCount)}.`;
}

/** The nudge, naming who hasn't joined. Empty when everyone has. */
export function leaderboardNudge(notJoined: readonly string[]): string {
  if (notJoined.length === 0) return "";
  const names =
    notJoined.length === 1
      ? notJoined[0]
      : `${notJoined.slice(0, -1).join(", ")} and ${notJoined[notJoined.length - 1]}`;
  return `${names} ${notJoined.length === 1 ? "isn't" : "aren't"} on it yet.`;
}

/** What "Ask them" sends: by the share sheet on Logjam GPS, copied on Logjam Web. */
export const LEADERBOARD_ASK_MESSAGE =
  "I've joined the Logjam canyon leaderboard. Turn it on in Settings, on Logjam Web or Logjam GPS, and we can compare seasons.";
